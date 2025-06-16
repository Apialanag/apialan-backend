// Archivo: routes/admin.routes.js (Versión Final Fusionada)

const express = require('express');
const router = express.Router();
const pool = require('../db');
const checkAuth = require('../middleware/check-auth');

// Este middleware se aplicará a todas las rutas de este archivo
router.use(checkAuth);

// =================================================================
//   RUTAS PARA LA GESTIÓN DE RESERVAS (Tu código original)
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
//   RUTAS PARA LA GESTIÓN DE SOCIOS (Tu código original)
// =================================================================

router.get('/socios', async (req, res) => {
  try {
    const todosLosSocios = await pool.query('SELECT * FROM "socios" ORDER BY nombre_completo ASC');
    res.status(200).json(todosLosSocios.rows);
  } catch (error) {
    console.error('Error al obtener socios:', error);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

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
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El RUT ingresado ya existe.' });
    }
    res.status(500).json({ error: 'Error del servidor al añadir el socio.' });
  }
});

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


// =================================================================
//   NUEVA RUTA PARA LAS ESTADÍSTICAS DEL DASHBOARD
// =================================================================

router.get('/stats', async (req, res) => {
  try {
    // Consultas para los KPIs
    const reservasHoyQuery = pool.query(`SELECT COUNT(*) FROM "reservas" WHERE fecha_reserva = CURRENT_DATE`);
    const ingresosMesQuery = pool.query(`SELECT SUM(costo_total) as total FROM "reservas" WHERE estado_reserva IN ('confirmada', 'pagado') AND DATE_TRUNC('month', fecha_reserva) = DATE_TRUNC('month', CURRENT_DATE)`);

    // Consultas para los Gráficos
    const reservasPorSalonQuery = pool.query(`SELECT e.nombre, COUNT(r.id) as cantidad FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id GROUP BY e.nombre`);
    const ingresosMesesQuery = pool.query(`SELECT TO_CHAR(DATE_TRUNC('month', fecha_reserva), 'YYYY-MM') as mes, SUM(costo_total) as ingresos FROM "reservas" WHERE fecha_reserva >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months' AND estado_reserva IN ('confirmada', 'pagado') GROUP BY DATE_TRUNC('month', fecha_reserva) ORDER BY mes ASC`);
    
    // Ejecutamos todas las consultas en paralelo
    const [
      reservasHoyResult,
      ingresosMesResult,
      reservasPorSalonResult,
      ingresosMesesResult
    ] = await Promise.all([
      reservasHoyQuery,
      ingresosMesQuery,
      reservasPorSalonQuery,
      ingresosMesesQuery
    ]);

    // Formateamos la respuesta final
    const stats = {
      kpis: {
        reservasHoy: parseInt(reservasHoyResult.rows[0].count, 10),
        ingresosMesActual: parseFloat(ingresosMesResult.rows[0].total) || 0,
      },
      graficos: {
        reservasPorSalon: reservasPorSalonResult.rows,
        ingresosUltimos6Meses: ingresosMesesResult.rows.map(row => ({
          mes: new Date(row.mes).toLocaleString('es-CL', { month: 'long', year: '2-digit' }),
          ingresos: parseFloat(row.ingresos)
        }))
      }
    };
    
    res.status(200).json(stats);

  } catch (err) {
    console.error("Error en GET /admin/stats:", err);
    res.status(500).json({ error: 'Error del servidor al obtener las estadísticas.' });
  }
});

module.exports = router;
