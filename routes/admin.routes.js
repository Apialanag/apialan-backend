// src/routes/admin.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const checkAuth = require('../middleware/check-auth');

// Este middleware se aplicará a todas las rutas de este archivo
router.use(checkAuth);

// RUTA: Obtener TODAS las reservas con todos los detalles para el admin
// --- AHORA CON LÓGICA DE PAGINACIÓN INTEGRADA ---
router.get('/reservas', async (req, res) => {
    try {
        // 1. Extraemos TODOS los filtros Y los nuevos parámetros de paginación de la URL.
        //    Asignamos valores por defecto a page y limit si no vienen.
        const { fecha_inicio, fecha_fin, estado, busqueda, page = 1, limit = 10 } = req.query;

        let queryText = `
            SELECT 
                r.*, 
                e.nombre AS nombre_espacio 
            FROM 
                Reservas r
            JOIN 
                Espacios e ON r.espacio_id = e.id
        `;
        
        const queryParams = [];
        const whereClauses = [];
        let paramIndex = 1;

        // --- Esta sección de construcción de filtros se mantiene igual ---
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

        // --- INICIA LA NUEVA LÓGICA DE PAGINACIÓN ---

        // 2. PRIMERA CONSULTA: Contamos el total de items que coinciden con los filtros.
        const countQuery = `SELECT COUNT(*) FROM Reservas r ${whereStatement}`;
        const totalResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

        // 3. SEGUNDA CONSULTA: Obtenemos solo la página de datos que necesitamos.
        const offset = (page - 1) * limit; // Calculamos el desfase para la consulta SQL.

        // Añadimos LIMIT y OFFSET a la consulta principal.
        const mainQuery = `
          ${queryText}
          ${whereStatement}
          ORDER BY r.fecha_reserva DESC, r.hora_inicio ASC
          LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;
        // Los parámetros deben estar en el orden correcto.
        const mainParams = [...queryParams, limit, offset]; 

        const resultado = await pool.query(mainQuery, mainParams);
        
        // 4. Devolvemos el nuevo objeto de respuesta enriquecido con los datos de paginación.
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

module.exports = router;