// Archivo: routes/socios.routes.js

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Asegúrate de que la ruta a tu conexión de BD sea correcta

// --- ENDPOINT POST /socios/validar ---
// Recibe un RUT y verifica si corresponde a un socio activo.
router.post('/validar', async (req, res) => {
  const { rut } = req.body;

  // Verificación básica de que se recibió el RUT
  if (!rut) {
    return res.status(400).json({ error: 'El RUT es requerido.' });
  }

  try {
    // Busca en la base de datos un socio que coincida con el RUT y que esté activo.
    const socioResult = await pool.query(
      'SELECT id, nombre_completo, rut, estado FROM socios WHERE rut = $1 AND estado = $2',
      [rut, 'activo']
    );

    // Si la consulta no devuelve ninguna fila, el socio no existe o no está activo.
    if (socioResult.rows.length === 0) {
      return res.status(404).json({ error: 'RUT de socio no encontrado o inactivo.' });
    }

    // Si se encuentra el socio, se devuelve su información.
    // Omitimos datos sensibles, solo devolvemos lo necesario para el frontend.
    const socio = socioResult.rows[0];
    res.status(200).json({
      id: socio.id,
      nombre_completo: socio.nombre_completo,
      rut: socio.rut,
    });

  } catch (error) {
    console.error('Error en la validación del socio:', error);
    res.status(500).json({ error: 'Error del servidor al validar el socio.' });
  }
});

module.exports = router;
