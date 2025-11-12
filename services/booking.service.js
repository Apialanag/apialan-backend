// services/booking.service.js
const pool = require('../db');
const { isSaturday, parseISO } = require('date-fns');

const TASA_IVA = 0.19; // Tasa de IVA de Chile

// --- Función para obtener el lunes de una fecha determinada ---
const getMonday = (d) => {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // ajusta para que el lunes sea el primer día
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0]; // Devuelve en formato YYYY-MM-DD
};

// Modificado para aceptar un cliente de base de datos opcional para transacciones
const validarHorasSocio = async (
  rut_socio,
  fecha_reserva,
  duracionReserva,
  dbClient = null
) => {
  const queryRunner = dbClient || pool; // Usar el cliente de transacción si se proporciona, sino el pool global
  try {
    const socioResult = await queryRunner.query(
      'SELECT id FROM "socios" WHERE rut = $1 AND estado = $2',
      [rut_socio, 'activo']
    );
    if (socioResult.rowCount === 0) {
      return {
        success: false,
        error: 'El RUT proporcionado no corresponde a un socio activo.',
        status: 403,
      };
    }
    const socioId = socioResult.rows[0].id;

    const inicioSemana = getMonday(fecha_reserva);
    const finSemanaDate = new Date(inicioSemana);
    finSemanaDate.setDate(finSemanaDate.getDate() + 6); // Monday to Sunday
    const finSemana = finSemanaDate.toISOString().split('T')[0];

    const horasUsadasQuery = `
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (hora_termino - hora_inicio))/3600), 0) as total_horas
      FROM "reservas"
      WHERE socio_id = $1
        AND fecha_reserva >= $2 -- Fecha de inicio de la reserva dentro de la semana
        AND fecha_reserva <= $3
        AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin', 'rechazada');
    `;
    const horasUsadasResult = await queryRunner.query(horasUsadasQuery, [
      socioId,
      inicioSemana,
      finSemana,
    ]);
    const horasUsadas = parseFloat(horasUsadasResult.rows[0].total_horas);

    if (horasUsadas + duracionReserva > 6) {
      return {
        success: false,
        error: `Has superado tu límite de 6 horas semanales. Ya has usado ${horasUsadas} horas.`,
        status: 403,
      };
    }
    return { success: true, socioId: socioId };
  } catch (error) {
    console.error('Error en validarHorasSocio:', error);
    return {
      success: false,
      error: 'Error interno al validar horas del socio.',
      status: 500,
    };
  }
};

const calcularDesgloseCostos = (
  espacio,
  duracionReserva,
  isSocioBooking,
  montoDescuentoCupon = 0,
  fecha_reserva // Añadido para verificar si es sábado
) => {
  let costoNetoBaseCalculado;
  const fecha = parseISO(fecha_reserva);

  // Precios especiales para los sábados, usando nombres para más robustez
  const preciosSabado = {
    general: {
      'Sala chica': 12000,
      'Sala Mediana': 18000,
      'Salón grande': 28000,
    },
    socio: {
      'Sala chica': 8000,
      'Sala Mediana': 10000,
      'Salón grande': 12000,
    },
  };

  if (isSaturday(fecha)) {
    if (isSocioBooking) {
      // Para socios, el precio del sábado es un neto fijo, sin importar la duración.
      const precioNetoSocio = preciosSabado.socio[espacio.nombre];
      if (precioNetoSocio) {
        costoNetoBaseCalculado = precioNetoSocio;
      } else {
        // Fallback si el nombre del espacio no coincide
        const precioNetoPorHoraAplicable = parseFloat(
          espacio.precio_neto_socio_por_hora
        );
        costoNetoBaseCalculado = precioNetoPorHoraAplicable * duracionReserva;
      }
    } else {
      // Para clientes generales, el precio del sábado es un total por hora.
      const precioTotalGeneralPorHora = preciosSabado.general[espacio.nombre];
      if (precioTotalGeneralPorHora) {
        const costoTotal = precioTotalGeneralPorHora * duracionReserva;
        costoNetoBaseCalculado = costoTotal / (1 + TASA_IVA);
      } else {
        // Fallback si el nombre del espacio no coincide
        const precioNetoPorHoraAplicable = parseFloat(
          espacio.precio_neto_por_hora
        );
        costoNetoBaseCalculado = precioNetoPorHoraAplicable * duracionReserva;
      }
    }
  } else {
    // Lógica de precios para días que no son sábado
    const precioNetoPorHoraAplicable = isSocioBooking
      ? parseFloat(espacio.precio_neto_socio_por_hora)
      : parseFloat(espacio.precio_neto_por_hora);

    if (isNaN(precioNetoPorHoraAplicable)) {
      console.error(
        `Error Crítico: No se pudo determinar un precio neto por hora válido para el espacio ID: ${
          espacio.id || 'desconocido'
        }. Socio: ${isSocioBooking}`
      );
      return {
        error: 'No se pudo determinar un precio base válido.',
      };
    }
    costoNetoBaseCalculado = precioNetoPorHoraAplicable * duracionReserva;
  }

  const descuentoRealAplicado = Math.min(
    costoNetoBaseCalculado,
    montoDescuentoCupon || 0
  );
  const netoFinalParaIVACalculado =
    costoNetoBaseCalculado - descuentoRealAplicado;
  const costoIvaCalculado = netoFinalParaIVACalculado * TASA_IVA;
  const costoTotalCalculado = netoFinalParaIVACalculado + costoIvaCalculado;

  return {
    costoNetoBase: parseFloat(costoNetoBaseCalculado.toFixed(2)),
    montoDescuentoAplicado: parseFloat(descuentoRealAplicado.toFixed(2)),
    netoFinalParaIVA: parseFloat(netoFinalParaIVACalculado.toFixed(2)),
    iva: parseFloat(costoIvaCalculado.toFixed(2)),
    total: parseFloat(costoTotalCalculado.toFixed(2)),
  };
};

module.exports = {
  getMonday,
  validarHorasSocio,
  calcularDesgloseCostos,
};
