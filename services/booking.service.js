// services/booking.service.js
const pool = require('../db');

const TASA_IVA = 0.19;

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

const calcularCostoTotal = (precioNetoPorHora, duracionReserva) => {
  // Asegurarse de que precioNetoPorHora es un número.
  const precioNetoHora = parseFloat(precioNetoPorHora);

  if (isNaN(precioNetoHora)) {
    console.error(`Error Crítico: El precioNetoPorHora ('${precioNetoPorHora}') no es un número válido.`);
    // Considerar devolver un error o un objeto con valores NaN o null para indicar el fallo.
    return { neto: NaN, iva: NaN, total: NaN };
  }

  const costoNeto = precioNetoHora * duracionReserva;
  const costoIva = costoNeto * TASA_IVA;
  const costoTotal = costoNeto + costoIva;

  // Devolver los valores redondeados a 2 decimales, es una práctica común para moneda.
  // Sin embargo, dado que la BD usa ROUND sin especificar decimales, se mantendrá así para consistencia,
  // aunque para moneda sería más usual Math.round(valor * 100) / 100.
  // Por ahora, se devuelve el valor calculado directamente.
  return {
    neto: costoNeto,
    iva: costoIva,
    total: costoTotal,
  };
};

module.exports = {
  getMonday,
  validarHorasSocio,
  calcularCostoTotal,
};
