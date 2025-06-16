// Archivo: routes/socios.routes.js

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Asegúrate de que la ruta a tu conexión de BD sea correcta

// --- ENDPOINT POST /socios/validar ---
// Recibe un RUT y lo valida sin importar los puntos, guiones o mayúsculas.
router.post('/validar', async (req, res) => {
  const { rut } = req.body;

  if (!rut) {
    return res.status(400).json({ error: 'El RUT es requerido.' });
  }

  try {
    // 1. Normalizamos el RUT que envía el usuario:
    //    - Quitamos todos los puntos y guiones usando una expresión regular.
    //    - Lo convertimos a minúsculas.
    const rutLimpioUsuario = rut.replace(/[.-]/g, '').toLowerCase();

    // 2. Modificamos la consulta SQL para que también normalice el RUT de la base de datos antes de comparar.
    //    - REPLACE(rut, '.', '') quita los puntos.
    //    - REPLACE(..., '-', '') quita los guiones del resultado anterior.
    //    - LOWER(...) convierte todo a minúsculas.
    const socioResult = await pool.query(
      `SELECT id, nombre_completo, rut, estado 
       FROM socios 
       WHERE LOWER(REPLACE(REPLACE(rut, '.', ''), '-', '')) = $1 AND estado = 'activo'`,
      [rutLimpioUsuario] // Comparamos contra el RUT limpio del usuario
    );

    if (socioResult.rows.length === 0) {
      return res.status(404).json({ error: 'RUT de socio no encontrado o inactivo.' });
    }

    const socio = socioResult.rows[0];
    res.status(200).json({
      id: socio.id,
      nombre_completo: socio.nombre_completo,
      rut: socio.rut, // Devolvemos el RUT original formateado
    });

  } catch (error) {
    console.error('Error en la validación del socio:', error);
    res.status(500).json({ error: 'Error del servidor al validar el socio.' });
  }
});

module.exports = router;
