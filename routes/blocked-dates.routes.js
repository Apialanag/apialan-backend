const express = require('express');
const router = express.Router();
const pool = require('../db'); // Asumiendo que db.js exporta el pool de PostgreSQL
const checkAuth = require('../middleware/check-auth'); // Para proteger rutas POST y DELETE
const checkIsAdmin = require('../middleware/check-is-admin'); // Para asegurar que solo admins puedan modificar

// GET /api/blocked-dates - Devuelve todas las fechas bloqueadas
router.get('/', async (req, res) => {
  try {
    const queryText = `SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, reason FROM "blocked_dates" ORDER BY date ASC;`;
    const resultado = await pool.query(queryText);
    res.status(200).json(resultado.rows);
  } catch (err) {
    console.error("Error al obtener las fechas bloqueadas:", err.message);
    res.status(500).json({ error: 'Error del servidor al obtener las fechas bloqueadas.' });
  }
});

// POST /api/blocked-dates - Crea una nueva fecha bloqueada (Solo Admin)
router.post('/', checkAuth, checkIsAdmin, async (req, res) => {
  try {
    const { date, reason } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'La fecha es obligatoria.' });
    }

    // Validar formato YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
    }

    const queryText = `INSERT INTO "blocked_dates" (date, reason) VALUES ($1, $2) RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, reason;`;
    const resultado = await pool.query(queryText, [date, reason]);
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    console.error("Error al crear la fecha bloqueada:", err.message);
    if (err.code === '23505') { // Error de violación de unicidad para 'date'
      return res.status(409).json({ error: 'Esta fecha ya está bloqueada.' });
    }
    res.status(500).json({ error: 'Error del servidor al crear la fecha bloqueada.' });
  }
});

// DELETE /api/blocked-dates/:dateString - Elimina una fecha bloqueada (Solo Admin)
// :dateString debe estar en formato YYYY-MM-DD
router.delete('/:dateString', checkAuth, checkIsAdmin, async (req, res) => {
  try {
    const { dateString } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return res.status(400).json({ error: 'Formato de fecha inválido en el parámetro. Use YYYY-MM-DD.' });
    }

    const queryText = `DELETE FROM "blocked_dates" WHERE date = $1 RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, reason;`;
    const resultado = await pool.query(queryText, [dateString]);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Fecha bloqueada no encontrada para eliminar.' });
    }
    res.status(200).json({ message: 'Fecha bloqueada eliminada exitosamente.', deletedDate: resultado.rows[0] });
  } catch (err) {
    console.error("Error al eliminar la fecha bloqueada:", err.message);
    res.status(500).json({ error: 'Error del servidor al eliminar la fecha bloqueada.' });
  }
});

module.exports = router;
