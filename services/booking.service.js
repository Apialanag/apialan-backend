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

  // Convertir los precios (que podrían ser strings si vienen de NUMERIC) a números
  // Asegurarse de que las propiedades existan antes de intentar parseFloat
  const precioSocioHoraStr = espacio.precio_socio_por_hora;
  const precioHoraStr = espacio.precio_por_hora;

  const precioSocioHora = (precioSocioHoraStr !== null && precioSocioHoraStr !== undefined) ? parseFloat(precioSocioHoraStr) : NaN;
  const precioHora = (precioHoraStr !== null && precioHoraStr !== undefined) ? parseFloat(precioHoraStr) : NaN;

  if (isSocioBooking) {
    if (!isNaN(precioSocioHora)) { // Usar el precio de socio si es un número válido después de parseFloat
      costoTotalCalculado = precioSocioHora * duracionReserva;
    } else {
      console.error(`Alerta: El valor de espacio.precio_socio_por_hora ('${precioSocioHoraStr}') no pudo ser convertido a un número válido, o no está definido para el espacio con ID: ${espacio.id || 'desconocido'}. Usando precio_por_hora estándar para socio.`);
      if (!isNaN(precioHora)) {
        costoTotalCalculado = precioHora * duracionReserva;
      } else {
        console.error(`Error Crítico: espacio.precio_por_hora ('${precioHoraStr}') tampoco es un número válido para el espacio con ID: ${espacio.id || 'desconocido'}.`);
        costoTotalCalculado = NaN; // O algún valor por defecto o manejo de error
      }
    }
  } else {
    if (!isNaN(precioHora)) {
      costoTotalCalculado = precioHora * duracionReserva;
    } else {
      console.error(`Error: espacio.precio_por_hora ('${precioHoraStr}') no es un número válido para el espacio con ID: ${espacio.id || 'desconocido'} en una reserva no-socio.`);
      costoTotalCalculado = NaN; // O algún valor por defecto o manejo de error
    }
  }
  // Ensure costoTotalCalculado is a valid number, default to 0 if not (or handle as error)
  return isNaN(costoTotalCalculado) ? 0 : costoTotalCalculado;
};

module.exports = {
  getMonday,
  validarHorasSocio,
  calcularCostoTotal,
};
