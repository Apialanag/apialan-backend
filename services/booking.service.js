// services/booking.service.js
const pool = require('../db');

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
const validarHorasSocio = async (rut_socio, fecha_reserva, duracionReserva, dbClient = null) => {
  const queryRunner = dbClient || pool; // Usar el cliente de transacción si se proporciona, sino el pool global
  try {
    const socioResult = await queryRunner.query('SELECT id FROM "socios" WHERE rut = $1 AND estado = $2', [rut_socio, 'activo']);
    if (socioResult.rowCount === 0) {
      return { success: false, error: 'El RUT proporcionado no corresponde a un socio activo.', status: 403 };
    }
    const socioId = socioResult.rows[0].id;

    const inicioSemana = getMonday(fecha_reserva);
    const finSemanaDate = new Date(inicioSemana);
    finSemanaDate.setDate(finSemanaDate.getDate() + 6); // Monday to Sunday
    const finSemana = finSemanaDate.toISOString().split('T')[0];

    // Consider only active reservations
    // Added estado_reserva check
    // Esta consulta ahora también debe considerar la nueva columna end_date para ser precisa
    // Sin embargo, la lógica de "horas usadas en la semana" se basa en la fecha_reserva.
    // Si una reserva larga abarca varias semanas, cómo se cuentan las horas es una política de negocio.
    // Por ahora, se mantiene la lógica original que cuenta la reserva completa en la semana de su fecha_reserva.
    const horasUsadasQuery = `
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (hora_termino - hora_inicio))/3600), 0) as total_horas
      FROM "reservas"
      WHERE socio_id = $1
        AND fecha_reserva >= $2 -- Fecha de inicio de la reserva dentro de la semana
        AND fecha_reserva <= $3
        AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin', 'rechazada');
    `;
    // Nota: Si una reserva es de rango largo (ej. Lun-Vie), todas sus horas se imputan a la semana del Lunes.
    // Esto podría necesitar revisión si las horas deben distribuirse o contarse de otra forma para rangos largos.
    const horasUsadasResult = await queryRunner.query(horasUsadasQuery, [socioId, inicioSemana, finSemana]);
    const horasUsadas = parseFloat(horasUsadasResult.rows[0].total_horas);

    if (horasUsadas + duracionReserva > 6) {
      return { success: false, error: `Has superado tu límite de 6 horas semanales. Ya has usado ${horasUsadas} horas.`, status: 403 };
    }
    return { success: true, socioId: socioId };
  } catch (error) {
    console.error('Error en validarHorasSocio:', error);
    return { success: false, error: 'Error interno al validar horas del socio.', status: 500 };
  }
};

/**
 * Calcula el desglose de costos (neto, IVA, total) para una reserva, aplicando opcionalmente un descuento de cupón.
 * @param {object} espacio - El objeto del espacio, debe contener precio_neto_por_hora y precio_neto_socio_por_hora.
 * @param {number} duracionReserva - La duración de la reserva en horas.
 * @param {boolean} isSocioBooking - True si la reserva es para un socio, false en caso contrario.
 * @param {number} [montoDescuentoCupon=0] - El monto del descuento del cupón a aplicar sobre el neto base.
 * @returns {object} Un objeto con { costoNetoBase, montoDescuentoAplicado, netoFinalParaIVA, iva, total } o { error: mensaje }.
 */
const calcularDesgloseCostos = (espacio, duracionReserva, isSocioBooking, montoDescuentoCupon = 0) => {
  let precioNetoPorHoraAplicable;

  // Determinar el precio neto por hora aplicable
  if (isSocioBooking) {
    const precioNetoSocioHoraStr = espacio.precio_neto_socio_por_hora; // Nombre de columna actualizado
    precioNetoPorHoraAplicable = (precioNetoSocioHoraStr !== null && precioNetoSocioHoraStr !== undefined)
                                  ? parseFloat(precioNetoSocioHoraStr)
                                  : NaN;
    if (isNaN(precioNetoPorHoraAplicable)) {
      console.error(`Alerta: El valor de espacio.precio_neto_socio_por_hora ('${precioNetoSocioHoraStr}') no es un número válido o no está definido para el espacio ID: ${espacio.id || 'desconocido'}. Se intentará usar precio_neto_por_hora estándar.`);
      // Fallback al precio no socio si el de socio no es válido pero el de no socio sí
      const precioNetoHoraStr = espacio.precio_neto_por_hora; // Nombre de columna actualizado
      precioNetoPorHoraAplicable = (precioNetoHoraStr !== null && precioNetoHoraStr !== undefined)
                                    ? parseFloat(precioNetoHoraStr)
                                    : NaN;
    }
  } else {
    const precioNetoHoraStr = espacio.precio_neto_por_hora; // Nombre de columna actualizado
    precioNetoPorHoraAplicable = (precioNetoHoraStr !== null && precioNetoHoraStr !== undefined)
                                  ? parseFloat(precioNetoHoraStr)
                                  : NaN;
  }

  // Validar que el precio neto por hora aplicable sea un número
  if (isNaN(precioNetoPorHoraAplicable)) {
    console.error(`Error Crítico: No se pudo determinar un precio neto por hora válido para el espacio ID: ${espacio.id || 'desconocido'}. Socio: ${isSocioBooking}`);
    return {
      costoNetoBase: NaN,
      montoDescuentoAplicado: NaN,
      netoFinalParaIVA: NaN,
      iva: NaN,
      total: NaN,
      error: "No se pudo determinar un precio base válido."
    };
  }

  const costoNetoBaseCalculado = precioNetoPorHoraAplicable * duracionReserva;

  // Aplicar descuento del cupón. Asegurarse de que el descuento no sea mayor que el neto base.
  const descuentoRealAplicado = Math.min(costoNetoBaseCalculado, montoDescuentoCupon || 0);
  const netoFinalParaIVACalculado = costoNetoBaseCalculado - descuentoRealAplicado;

  const costoIvaCalculado = netoFinalParaIVACalculado * TASA_IVA;
  const costoTotalCalculado = netoFinalParaIVACalculado + costoIvaCalculado;

  // Redondear a 2 decimales.
  return {
    costoNetoBase: parseFloat(costoNetoBaseCalculado.toFixed(2)), // Este es el que se guardará como costo_neto_historico
    montoDescuentoAplicado: parseFloat(descuentoRealAplicado.toFixed(2)),
    netoFinalParaIVA: parseFloat(netoFinalParaIVACalculado.toFixed(2)), // Base para el IVA
    iva: parseFloat(costoIvaCalculado.toFixed(2)),
    total: parseFloat(costoTotalCalculado.toFixed(2)), // Este es el costo_total_historico
  };
};

module.exports = {
  getMonday,
  validarHorasSocio,
  calcularDesgloseCostos, // Exportar la nueva función en lugar de la antigua
};
