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

const validarHorasSocio = async (rut_socio, fecha_reserva, duracionReserva) => {
  try {
    const socioResult = await pool.query('SELECT id FROM "socios" WHERE rut = $1 AND estado = $2', [rut_socio, 'activo']);
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
    const horasUsadasQuery = `
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (hora_termino - hora_inicio))/3600), 0) as total_horas
      FROM "reservas"
      WHERE socio_id = $1
        AND fecha_reserva >= $2
        AND fecha_reserva <= $3
        AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin', 'rechazada');
    `;
    const horasUsadasResult = await pool.query(horasUsadasQuery, [socioId, inicioSemana, finSemana]);
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
 * Calcula el desglose de costos (neto, IVA, total) para una reserva.
 * @param {object} espacio - El objeto del espacio, debe contener precio_neto_por_hora y precio_neto_socio_por_hora.
 * @param {number} duracionReserva - La duración de la reserva en horas.
 * @param {boolean} isSocioBooking - True si la reserva es para un socio, false en caso contrario.
 * @returns {object} Un objeto con { neto, iva, total } o { error: mensaje } si hay problemas.
 */
const calcularDesgloseCostos = (espacio, duracionReserva, isSocioBooking) => {
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
    // Devolver un objeto de error o lanzar una excepción podría ser más robusto aquí.
    // Por ahora, para mantener consistencia con la lógica anterior, devolvemos un objeto con valores NaN o 0 para indicar fallo.
    return { neto: NaN, iva: NaN, total: NaN, error: "No se pudo determinar un precio base válido." };
  }

  const costoNetoCalculado = precioNetoPorHoraAplicable * duracionReserva;
  const costoIvaCalculado = costoNetoCalculado * TASA_IVA;
  const costoTotalCalculado = costoNetoCalculado + costoIvaCalculado;

  // Redondear a 2 decimales es una buena práctica para montos de dinero.
  // El uso de .toFixed(2) devuelve string, por lo que se convierte de nuevo a número.
  return {
    neto: parseFloat(costoNetoCalculado.toFixed(2)),
    iva: parseFloat(costoIvaCalculado.toFixed(2)),
    total: parseFloat(costoTotalCalculado.toFixed(2)),
  };
};

module.exports = {
  getMonday,
  validarHorasSocio,
  calcularDesgloseCostos, // Exportar la nueva función en lugar de la antigua
};
