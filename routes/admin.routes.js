// Archivo: routes/admin.routes.js (Versión Final Fusionada)

const express = require('express');
const router = express.Router();
const pool = require('../db');
const checkAuth = require('../middleware/check-auth');

// Este middleware se aplicará a todas las rutas de este archivo
router.use(checkAuth);

// =================================================================
//   RUTAS PARA LA GESTIÓN DE RESERVAS (Tu código original mejorado)
// =================================================================

router.get('/reservas', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, estado, busqueda, page = 1, limit = 10 } = req.query;

        // Se usan comillas dobles para los nombres de las tablas por seguridad y consistencia
        let queryText = `
            SELECT 
                r.*, 
                e.nombre AS nombre_espacio 
            FROM 
                "reservas" r
            JOIN 
                "espacios" e ON r.espacio_id = e.id
        `;
        
        const queryParams = [];
        const whereClauses = [];
        let paramIndex = 1;

        if (fecha_inicio) {
            whereClauses.push(`r.fecha_reserva >= $${paramIndex++}`);
            queryParams.push(fecha_inicio);
        }
        if (fecha_fin) {
            whereClauses.push(`r.fecha_reserva <= $${paramIndex++}`);
            queryParams.push(fecha_fin);
        }
        if (estado) {
            whereClauses.push(`r.estado_reserva = $${paramIndex++}`);
            queryParams.push(estado);
        }
        if (busqueda) {
            whereClauses.push(`(r.cliente_nombre ILIKE $${paramIndex} OR r.cliente_email ILIKE $${paramIndex})`);
            queryParams.push(`%${busqueda}%`);
            paramIndex++;
        }

        const whereStatement = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
        
        const countQuery = `SELECT COUNT(*) FROM "reservas" r ${whereStatement}`;
        const totalResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);
        
        const offset = (page - 1) * limit;

        const mainQuery = `
          ${queryText}
          ${whereStatement}
          ORDER BY r.fecha_reserva DESC, r.hora_inicio ASC
          LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;
        const mainParams = [...queryParams, limit, offset]; 

        const resultado = await pool.query(mainQuery, mainParams);
        
        res.status(200).json({
            reservas: resultado.rows,
            totalItems,
            totalPages,
            currentPage: parseInt(page, 10),
        });

    } catch (err) {
        console.error("Error en GET /admin/reservas:", err);
        res.status(500).json({ error: 'Error del servidor al obtener las reservas.' });
    }
});


// =================================================================
//   NUEVAS RUTAS PARA LA GESTIÓN DE SOCIOS
// =================================================================

// --- RUTA 1: OBTENER TODOS LOS SOCIOS (GET /admin/socios) ---
router.get('/socios', async (req, res) => {
  try {
    const todosLosSocios = await pool.query('SELECT * FROM "socios" ORDER BY nombre_completo ASC');
    res.status(200).json(todosLosSocios.rows);
  } catch (error) {
    console.error('Error al obtener socios:', error);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

// --- RUTA 2: AÑADIR UN NUEVO SOCIO (POST /admin/socios) ---
router.post('/socios', async (req, res) => {
  const { nombre_completo, rut } = req.body;
  if (!nombre_completo || !rut) {
    return res.status(400).json({ error: 'Nombre y RUT son requeridos.' });
  }
  try {
    const nuevoSocio = await pool.query(
      'INSERT INTO "socios" (nombre_completo, rut, estado) VALUES ($1, $2, $3) RETURNING *',
      [nombre_completo, rut, 'activo']
    );
    res.status(201).json(nuevoSocio.rows[0]);
  } catch (error) {
    console.error('Error al añadir socio:', error);
    if (error.code === '23505') { // Código de error para violación de constraint 'unique'
      return res.status(409).json({ error: 'El RUT ingresado ya existe.' });
    }
    res.status(500).json({ error: 'Error del servidor al añadir el socio.' });
  }
});

// --- RUTA 3: EDITAR UN SOCIO (PUT /admin/socios/:id) ---
router.put('/socios/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre_completo, rut, estado } = req.body;
  try {
    const socioActualizado = await pool.query(
      'UPDATE "socios" SET nombre_completo = $1, rut = $2, estado = $3 WHERE id = $4 RETURNING *',
      [nombre_completo, rut, estado, id]
    );
    if (socioActualizado.rows.length === 0) {
      return res.status(404).json({ error: 'Socio no encontrado.' });
    }
    res.status(200).json(socioActualizado.rows[0]);
  } catch (error) {
    console.error('Error al editar socio:', error);
    res.status(500).json({ error: 'Error del servidor al editar el socio.' });
  }
});

// --- RUTA 4: ELIMINAR UN SOCIO (DELETE /admin/socios/:id) ---
router.delete('/socios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query('DELETE FROM "socios" WHERE id = $1 RETURNING *', [id]);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Socio no encontrado para eliminar.' });
    }
    res.status(200).json({ message: 'Socio eliminado exitosamente.' });
  } catch (error) {
    console.error('Error al eliminar socio:', error);
    res.status(500).json({ error: 'Error del servidor al eliminar el socio.' });
  }
});


module.exports = router;