// Archivo: routes/reservas.routes.js (Versión Final y Corregida)

const express = require('express');
const router = express.Router();
const pool = require('../db');
const checkAuth = require('../middleware/check-auth');
const { 
  enviarEmailSolicitudRecibida,
  enviarEmailReservaConfirmada,
  enviarEmailCancelacionCliente, 
  enviarEmailCancelacionAdmin 
} = require('../services/email.service');
const { validarHorasSocio, calcularCostoTotal } = require('../services/booking.service.js');

// ----------------------------------------------------------------
// RUTA PÚBLICA para consultar disponibilidad
// ----------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { fecha, espacio_id, mes } = req.query;
    let queryText = `SELECT id, espacio_id, fecha_reserva, hora_inicio, hora_termino, estado_reserva FROM "reservas"`;
    const queryParams = [];
    const whereClauses = [];
    let paramIndex = 1;

    // Add the mandatory filter for reservation status
    // No parameters needed for this part of the clause, so paramIndex is not incremented here.
    whereClauses.push(`estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin')`);

    if (espacio_id) { whereClauses.push(`espacio_id = $${paramIndex++}`); queryParams.push(espacio_id); }
    if (fecha) { whereClauses.push(`fecha_reserva = $${paramIndex++}`); queryParams.push(fecha); }
    if (mes) {
      const [year, month] = mes.split('-').map(Number);
      if (year && month) {
        whereClauses.push(`EXTRACT(YEAR FROM fecha_reserva) = $${paramIndex++}`); queryParams.push(year);
        whereClauses.push(`EXTRACT(MONTH FROM fecha_reserva) = $${paramIndex++}`); queryParams.push(month);
      }
    }
    if (whereClauses.length > 0) { queryText += ' WHERE ' + whereClauses.join(' AND '); }
    queryText += ' ORDER BY fecha_reserva ASC, hora_inicio ASC;';
    const resultado = await pool.query(queryText, queryParams);
    res.status(200).json(resultado.rows);
  } catch (err) {
    console.error("Error al obtener las reservas públicas:", err.message);
    res.status(500).json({ error: 'Error del servidor al obtener las reservas.' });
  }
});

// ----------------------------------------------------------------
// RUTA PÚBLICA para crear una nueva reserva (LÓGICA FUSIONADA)
// ----------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { espacio_id, cliente_nombre, cliente_email, cliente_telefono, fecha_reserva, hora_inicio, hora_termino, notas_adicionales, rut_socio } = req.body;

    if (!espacio_id || !cliente_nombre || !cliente_email || !fecha_reserva || !hora_inicio || !hora_termino) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para la reserva.' });
    }

    const chequeoDisponibilidadQuery = `SELECT id FROM "reservas" WHERE espacio_id = $1 AND fecha_reserva = $2 AND (hora_inicio < $4 AND hora_termino > $3) AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin');`;
    const resultadoChequeo = await pool.query(chequeoDisponibilidadQuery, [espacio_id, fecha_reserva, hora_inicio, hora_termino]);
    if (resultadoChequeo.rowCount > 0) {
      return res.status(409).json({ error: 'El espacio ya está reservado para el horario solicitado.' });
    }
    
    const espacioResult = await pool.query('SELECT nombre, precio_por_hora, precio_socio_por_hora FROM "espacios" WHERE id = $1', [espacio_id]);
    if (espacioResult.rowCount === 0) {
      return res.status(404).json({ error: `Espacio con id ${espacio_id} no encontrado.` });
    }
    const espacio = espacioResult.rows[0];
    const duracionReserva = parseInt(hora_termino.split(':')[0]) - parseInt(hora_inicio.split(':')[0]);

    let socioId = null;
    let isSocioBooking = false;

    if (rut_socio) {
      const validacionSocio = await validarHorasSocio(rut_socio, fecha_reserva, duracionReserva);
      if (!validacionSocio.success) {
        return res.status(validacionSocio.status).json({ error: validacionSocio.error });
      }
      socioId = validacionSocio.socioId;
      isSocioBooking = true;
    }

    const costoTotalCalculado = calcularCostoTotal(espacio, duracionReserva, isSocioBooking);

    const nuevaReservaQuery = `INSERT INTO "reservas" (espacio_id, cliente_nombre, cliente_email, cliente_telefono, fecha_reserva, hora_inicio, hora_termino, costo_total, notas_adicionales, socio_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;`;
    const values = [espacio_id, cliente_nombre, cliente_email, cliente_telefono, fecha_reserva, hora_inicio, hora_termino, costoTotalCalculado, notas_adicionales, socioId];
    const resultado = await pool.query(nuevaReservaQuery, values);
    const reservaCreada = resultado.rows[0];
    
    reservaCreada.nombre_espacio = espacio.nombre;
    await enviarEmailSolicitudRecibida(reservaCreada);
    res.status(201).json({ mensaje: 'Solicitud de reserva recibida. Por favor, realiza el pago para confirmar.', reserva: reservaCreada });

  } catch (err) {
    console.error("Error al crear la reserva:", err.message);
    if (err.code === '23503') { return res.status(400).json({ error: `El espacio_id proporcionado no es válido.` }); }
    res.status(500).json({ error: 'Error del servidor al crear la reserva.' });
  }
});


// ----------------------------------------------------------------
// RUTAS PROTEGIDAS (Solo para Administradores)
// ----------------------------------------------------------------

router.get('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const queryText = `SELECT r.*, e.nombre AS nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultado = await pool.query(queryText, [id]);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }
    res.status(200).json(resultado.rows[0]);
  } catch(err) {
    console.error(`Error al obtener reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor.'});
  }
});

router.put('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado_reserva, estado_pago } = req.body;
    if (estado_reserva === undefined && estado_pago === undefined) {
      return res.status(400).json({ error: 'No se proporcionaron campos válidos para actualizar.' });
    }
    const camposAActualizar = [];
    const valoresAActualizar = [];
    let parametroIndex = 1;
    if (estado_reserva !== undefined) {
      camposAActualizar.push(`estado_reserva = $${parametroIndex++}`);
      valoresAActualizar.push(estado_reserva);
    }
    if (estado_pago !== undefined) {
      camposAActualizar.push(`estado_pago = $${parametroIndex++}`);
      valoresAActualizar.push(estado_pago);
    }
    const updateQuery = `UPDATE "reservas" SET ${camposAActualizar.join(', ')} WHERE id = $${parametroIndex} RETURNING *;`;
    valoresAActualizar.push(id);
    const resultado = await pool.query(updateQuery, valoresAActualizar);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada para actualizar.' });
    }
    const reservaActualizadaQuery = `SELECT r.*, e.nombre as nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultadoFinal = await pool.query(reservaActualizadaQuery, [id]);
    const reservaActualizada = resultadoFinal.rows[0];
    if (estado_reserva) { 
      if (estado_reserva === 'confirmada') await enviarEmailReservaConfirmada(reservaActualizada);
      else if (estado_reserva === 'cancelada_por_admin') await enviarEmailCancelacionAdmin(reservaActualizada);
      else if (estado_reserva === 'cancelada_por_cliente') await enviarEmailCancelacionCliente(reservaActualizada);
    }
    res.status(200).json({ mensaje: 'Reserva actualizada exitosamente.', reserva: reservaActualizada });
  } catch (err) {
    console.error(`Error al actualizar la reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor al actualizar la reserva.' });
  }
});

router.delete('/:id', checkAuth, async (req, res) => {
  // --- CORRECCIÓN: Se añade la llave de apertura del 'try' ---
  try {
    const { id } = req.params;
    const nuevoEstado = 'cancelada_por_admin';
    const cancelarReservaQuery = `UPDATE "reservas" SET estado_reserva = $1 WHERE id = $2 RETURNING *;`;
    const resultadoUpdate = await pool.query(cancelarReservaQuery, [nuevoEstado, id]);
    if (resultadoUpdate.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada para cancelar.' });
    }
    const reservaCanceladaQuery = `SELECT r.*, e.nombre as nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultadoFinal = await pool.query(reservaCanceladaQuery, [id]);
    const reservaCancelada = resultadoFinal.rows[0];
    await enviarEmailCancelacionAdmin(reservaCancelada);
    res.status(200).json({ mensaje: 'Reserva cancelada exitosamente.', reserva: reservaCancelada });
  } catch (err) {
    console.error(`Error al cancelar la reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor al cancelar la reserva.' });
  }
});

module.exports = router;
