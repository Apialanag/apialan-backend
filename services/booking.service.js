// services/booking.service.js
const pool = require('../db');

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

const calcularCostoTotal = (espacio, duracionReserva, isSocioBooking) => {
  let costoTotalCalculado;
  if (isSocioBooking) {
    if (typeof espacio.precio_socio_por_hora === 'number' && !isNaN(espacio.precio_socio_por_hora)) {
      costoTotalCalculado = parseFloat(espacio.precio_socio_por_hora) * duracionReserva;
    } else {
      // Log an error if socio price is expected but not available or invalid
      console.error(`Alerta: precio_socio_por_hora no está definido, no es un número, o es NaN para el espacio con ID: ${espacio.id || 'desconocido'}. Usando precio_por_hora estándar para socio.`);
      costoTotalCalculado = parseFloat(espacio.precio_por_hora) * duracionReserva;
    }
  } else {
    costoTotalCalculado = parseFloat(espacio.precio_por_hora) * duracionReserva;
  }
  // Ensure costoTotalCalculado is a valid number, default to 0 if not (or handle as error)
  return isNaN(costoTotalCalculado) ? 0 : costoTotalCalculado;
};

module.exports = {
  getMonday,
  validarHorasSocio,
  calcularCostoTotal,
};
