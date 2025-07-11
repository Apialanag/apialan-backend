const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const queryText = `
      SELECT
        id,
        nombre,
        capacidad,
        comodidades,      -- As specified by user
        precio_neto_por_hora,     -- Actualizado
        precio_neto_socio_por_hora, -- Actualizado
        fotos
      FROM
        "espacios"
      ORDER BY
        id ASC;
    `;
    const todosLosEspacios = await pool.query(queryText);
    res.json(todosLosEspacios.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error del servidor al obtener espacios' });
  }
});

module.exports = router;
