const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const queryText = `
      SELECT
        id,
        nombre,
        precio_por_hora,
        precio_socio_por_hora,
        capacidad,        // Assuming this exists from general context
        descripcion,      // Assuming this exists
        foto_url,         // Assuming this exists
        esta_activo       // Assuming this exists
      FROM
        "Espacios"
      ORDER BY
        id ASC
    `;
    const todosLosEspacios = await pool.query(queryText);
    res.json(todosLosEspacios.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error del servidor al obtener espacios' });
  }
});

module.exports = router;