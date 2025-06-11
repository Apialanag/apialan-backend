// src/routes/reservas.routes.js
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

// ----------------------------------------------------------------
// RUTA PÚBLICA para consultar disponibilidad (no devuelve datos sensibles)
// ----------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { fecha, espacio_id, mes } = req.query;
    let queryText = `SELECT id, espacio_id, fecha_reserva, hora_inicio, hora_termino, estado_reserva FROM Reservas`;
    const queryParams = [];
    const whereClauses = [];
    let paramIndex = 1;
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
// RUTA PÚBLICA para crear una nueva reserva (SOLICITUD)
// ----------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { espacio_id, cliente_nombre, cliente_email, cliente_telefono, fecha_reserva, hora_inicio, hora_termino, notas_adicionales } = req.body;
    if (!espacio_id || !cliente_nombre || !cliente_email || !fecha_reserva || !hora_inicio || !hora_termino) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para la reserva.' });
    }
    const chequeoDisponibilidadQuery = `SELECT id FROM Reservas WHERE espacio_id = $1 AND fecha_reserva = $2 AND (hora_inicio < $4 AND hora_termino > $3) AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin');`;
    const resultadoChequeo = await pool.query(chequeoDisponibilidadQuery, [espacio_id, fecha_reserva, hora_inicio, hora_termino]);
    if (resultadoChequeo.rowCount > 0) {
      return res.status(409).json({ error: 'El espacio ya está reservado para el horario solicitado.' });
    }
    
    const espacioResult = await pool.query('SELECT nombre, precio_por_hora FROM Espacios WHERE id = $1', [espacio_id]);
    if (espacioResult.rowCount === 0) {
      return res.status(404).json({ error: `Espacio con id ${espacio_id} no encontrado.` });
    }

    const precioPorHora = parseFloat(espacioResult.rows[0].precio_por_hora);
    const duracionEnHoras = parseInt(hora_termino.split(':')[0]) - parseInt(hora_inicio.split(':')[0]);
    const costoTotalCalculado = duracionEnHoras * precioPorHora;
    // La reserva se crea con estado 'solicitada' por defecto.
    const nuevaReservaQuery = `INSERT INTO Reservas (espacio_id, cliente_nombre, cliente_email, cliente_telefono, fecha_reserva, hora_inicio, hora_termino, costo_total, notas_adicionales) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;`;
    const values = [espacio_id, cliente_nombre, cliente_email, cliente_telefono, fecha_reserva, hora_inicio, hora_termino, costoTotalCalculado, notas_adicionales];
    const resultado = await pool.query(nuevaReservaQuery, values);
    
    const reservaCreada = resultado.rows[0];
    reservaCreada.nombre_espacio = espacioResult.rows[0].nombre;
    
    // <-- CAMBIO: Se envía el email de "Solicitud Recibida" en lugar del de confirmación.
    await enviarEmailSolicitudRecibida(reservaCreada);

    // <-- CAMBIO: El mensaje de respuesta refleja que es una solicitud pendiente de pago/confirmación.
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

// RUTA PROTEGIDA para obtener UNA reserva con todos los detalles
router.get('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const queryText = `SELECT r.*, e.nombre AS nombre_espacio FROM Reservas r JOIN Espacios e ON r.espacio_id = e.id WHERE r.id = $1`;
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

// RUTA PROTEGIDA para MODIFICAR una reserva (Ej: confirmar, cambiar estado de pago)
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

    const updateQuery = `UPDATE Reservas SET ${camposAActualizar.join(', ')} WHERE id = $${parametroIndex} RETURNING *;`;
    valoresAActualizar.push(id);
    
    const resultado = await pool.query(updateQuery, valoresAActualizar);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada para actualizar.' });
    }
    
    const reservaActualizadaQuery = `SELECT r.*, e.nombre as nombre_espacio FROM Reservas r JOIN Espacios e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultadoFinal = await pool.query(reservaActualizadaQuery, [id]);
    const reservaActualizada = resultadoFinal.rows[0];

    // <-- CAMBIO: Lógica inteligente ampliada para el envío de correos según el nuevo estado.
    if (estado_reserva) { 
      // Si el nuevo estado es 'confirmada', se envía el email de confirmación.
      if (estado_reserva === 'confirmada') {
          await enviarEmailReservaConfirmada(reservaActualizada);
      } 
      // Si el estado es de cancelación, se envía el email correspondiente.
      else if (estado_reserva === 'cancelada_por_admin') {
          await enviarEmailCancelacionAdmin(reservaActualizada);
      } else if (estado_reserva === 'cancelada_por_cliente') {
          await enviarEmailCancelacionCliente(reservaActualizada);
      }
    }

    res.status(200).json({
      mensaje: 'Reserva actualizada exitosamente.',
      reserva: reservaActualizada
    });

  } catch (err) {
    console.error(`Error al actualizar la reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor al actualizar la reserva.' });
  }
});

// RUTA PROTEGIDA para CANCELAR una reserva (Equivalente a una actualización de estado)
router.delete('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const nuevoEstado = 'cancelada_por_admin';
    const cancelarReservaQuery = `UPDATE Reservas SET estado_reserva = $1 WHERE id = $2 RETURNING *;`;
    // No es necesario hacer dos queries, el primero ya puede devolver los datos.
    const resultadoUpdate = await pool.query(cancelarReservaQuery, [nuevoEstado, id]);

    if (resultadoUpdate.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada para cancelar.' });
    }
    
    // Se necesita el nombre del espacio para el email, por lo que hacemos un JOIN.
    const reservaCanceladaQuery = `SELECT r.*, e.nombre as nombre_espacio FROM Reservas r JOIN Espacios e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultadoFinal = await pool.query(reservaCanceladaQuery, [id]);
    const reservaCancelada = resultadoFinal.rows[0];

    // Se llama a la función específica de cancelación por admin.
    await enviarEmailCancelacionAdmin(reservaCancelada);

    res.status(200).json({
      mensaje: 'Reserva cancelada exitosamente.', // Mensaje más específico
      reserva: reservaCancelada
    });
  } catch (err) {
    console.error(`Error al cancelar la reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor al cancelar la reserva.' });
  }
});

module.exports = router;