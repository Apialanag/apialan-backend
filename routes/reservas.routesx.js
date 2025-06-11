// routes/reservas.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// Ruta para OBTENER reservas, con filtros opcionales
// GET /api/reservas/
// GET /api/reservas?fecha=YYYY-MM-DD
// GET /api/reservas?espacio_id=X
// GET /api/reservas?mes=YYYY-MM
// Ruta para OBTENER reservas, con filtros opcionales

router.get('/', async (req, res) => {
  try {
    const { fecha, espacio_id, mes } = req.query;

    let todasLasReservasQuery = 'SELECT * FROM Reservas';
    const queryParams = [];
    const whereClauses = [];
    let paramIndex = 1;

    if (espacio_id) {
      whereClauses.push(`espacio_id = $${paramIndex++}`);
      queryParams.push(espacio_id);
    }

    if (fecha) {
      whereClauses.push(`fecha_reserva = $${paramIndex++}`);
      queryParams.push(fecha);
    }
    
    // --- INICIO: Implementación del filtro por mes ---
    if (mes) {
      const partesMes = mes.split('-');
      if (partesMes.length === 2 && partesMes[0].length === 4 && partesMes[1].length === 2) {
        const year = parseInt(partesMes[0]);
        const month = parseInt(partesMes[1]);

        if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
          whereClauses.push(`EXTRACT(YEAR FROM fecha_reserva) = $${paramIndex++}`);
          queryParams.push(year);
          whereClauses.push(`EXTRACT(MONTH FROM fecha_reserva) = $${paramIndex++}`);
          queryParams.push(month);
        } else {
          return res.status(400).json({ error: "Valores de año o mes inválidos en el parámetro 'mes'. Use YYYY-MM con números válidos." });
        }
      } else {
        return res.status(400).json({ error: "Formato de parámetro 'mes' incorrecto. Use YYYY-MM." });
      }
    }

    
router.get('/', async (req, res) => {
  try {
    // Obtenemos los query parameters de la URL
    const { fecha, espacio_id, mes } = req.query;

    let todasLasReservasQuery = 'SELECT * FROM Reservas'; // Query base
    const queryParams = [];
    const whereClauses = [];

    let paramIndex = 1;

    if (espacio_id) {
      whereClauses.push(`espacio_id = $${paramIndex++}`);
      queryParams.push(espacio_id);
    }

    if (fecha) {
      whereClauses.push(`fecha_reserva = $${paramIndex++}`);
      queryParams.push(fecha);
    }
    
    // TODO: Implementar filtro por mes si se desea.
    // Esto requeriría extraer el año y mes de fecha_reserva en SQL,
    // ej: WHERE EXTRACT(YEAR FROM fecha_reserva) = $X AND EXTRACT(MONTH FROM fecha_reserva) = $Y
    // Por ahora, lo dejaremos pendiente para mantenerlo simple.
    if (mes) {
        // Ejemplo de cómo podría ser (requiere validación y parsing de 'mes')
        // const [year, month] = mes.split('-');
        // whereClauses.push(`EXTRACT(YEAR FROM fecha_reserva) = $${paramIndex++}`);
        // queryParams.push(parseInt(year));
        // whereClauses.push(`EXTRACT(MONTH FROM fecha_reserva) = $${paramIndex++}`);
        // queryParams.push(parseInt(month));
        console.log("Filtro por mes aún no implementado completamente.");
    }

    if (whereClauses.length > 0) {
      todasLasReservasQuery += ' WHERE ' + whereClauses.join(' AND ');
    }

    todasLasReservasQuery += ' ORDER BY fecha_reserva ASC, hora_inicio ASC;';
    
    console.log("Ejecutando query:", todasLasReservasQuery); // Para depurar la query construida
    console.log("Con parámetros:", queryParams); // Para depurar los parámetros

    const resultado = await pool.query(todasLasReservasQuery, queryParams);

    res.status(200).json(resultado.rows);

  } catch (err) {
    console.error("Error al obtener las reservas:", err.message);
    console.error("Stack del error:", err.stack);
    res.status(500).json({ error: 'Error del servidor al obtener las reservas.' });
  }
});

// Ruta para OBTENER TODAS las reservas
// GET /api/reservas/
router.get('/', async (req, res) => {
  try {
    // Podríamos añadir JOIN con Espacios para obtener el nombre del espacio,
    // pero por ahora, solo las reservas.
    // También podríamos ordenar por fecha_reserva y hora_inicio.
    const todasLasReservasQuery = `
      SELECT * FROM Reservas 
      ORDER BY fecha_reserva ASC, hora_inicio ASC;
    `;

    const resultado = await pool.query(todasLasReservasQuery);

    res.status(200).json(resultado.rows); // Enviamos todas las filas encontradas

  } catch (err) {
    console.error("Error al obtener las reservas:", err.message);
    console.error("Stack del error:", err.stack);
    res.status(500).json({ error: 'Error del servidor al obtener las reservas.' });
  }
});

// Ruta para OBTENER UNA reserva específica por su ID
// GET /api/reservas/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params; // Obtenemos el ID de los parámetros de la URL

    // También podríamos hacer un JOIN con la tabla Espacios para incluir el nombre del espacio
    const unaReservaQuery = 'SELECT * FROM Reservas WHERE id = $1';
    const resultado = await pool.query(unaReservaQuery, [id]);

    if (resultado.rowCount === 0) {
      // Si no se encuentra ninguna reserva con ese ID
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }

    res.status(200).json(resultado.rows[0]); // Enviamos la primera (y única) fila encontrada

  } catch (err) {
    console.error(`Error al obtener la reserva ${req.params.id}:`, err.message);
    console.error("Stack del error:", err.stack);
    // Podríamos verificar si el error es porque 'id' no es un número válido antes de que llegue a la BD
    if (isNaN(parseInt(req.params.id, 10))) {
        return res.status(400).json({ error: 'El ID de la reserva debe ser un número.' });
    }
    res.status(500).json({ error: 'Error del servidor al obtener la reserva.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      espacio_id,
      cliente_nombre,
      cliente_email,
      cliente_telefono,
      fecha_reserva,
      hora_inicio,
      hora_termino,
      notas_adicionales
    } = req.body;

    // 2. Validación simple de campos obligatorios (sin costo_total aquí)
    if (!espacio_id || !cliente_nombre || !cliente_email || !fecha_reserva || !hora_inicio || !hora_termino) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para la reserva (espacio, cliente, fecha, horas).' });
    }

    // --- INICIO DE LA VALIDACIÓN DE DISPONIBILIDAD ---
    const chequeoDisponibilidadQuery = `
      SELECT id FROM Reservas
      WHERE espacio_id = $1
        AND fecha_reserva = $2
        AND (
          (hora_inicio < $4 AND hora_termino > $3) 
        )
        AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin');
    `;
    const chequeoValues = [espacio_id, fecha_reserva, hora_inicio, hora_termino];
    const resultadoChequeo = await pool.query(chequeoDisponibilidadQuery, chequeoValues);

    if (resultadoChequeo.rowCount > 0) {
      return res.status(409).json({ // 409 Conflict es un buen código de estado para esto
        error: 'El espacio ya está reservado para el horario solicitado en esta fecha.',
      });
    }
    // --- FIN DE LA VALIDACIÓN DE DISPONIBILIDAD ---

    // --- INICIO CÁLCULO DE COSTO EN BACKEND ---
    // 3. Obtener precio por hora del espacio
    const espacioQuery = 'SELECT precio_por_hora FROM Espacios WHERE id = $1';
    const espacioResult = await pool.query(espacioQuery, [espacio_id]);

    if (espacioResult.rowCount === 0) {
      return res.status(404).json({ error: `Espacio con id ${espacio_id} no encontrado.` });
    }
    const precioPorHora = parseFloat(espacioResult.rows[0].precio_por_hora);

    // 4. Calcular duración en horas
    const [hInicio, mInicio] = hora_inicio.split(':').map(Number);
    const [hTermino, mTermino] = hora_termino.split(':').map(Number);

    const inicioEnMinutos = hInicio * 60 + mInicio;
    const terminoEnMinutos = hTermino * 60 + mTermino;

    if (terminoEnMinutos <= inicioEnMinutos) {
        return res.status(400).json({ error: 'La hora de término debe ser posterior a la hora de inicio.' });
    }

    const duracionEnMinutos = terminoEnMinutos - inicioEnMinutos;
    const duracionEnHoras = duracionEnMinutos / 60;

    // 5. Calcular costo total
    const costoTotalCalculado = duracionEnHoras * precioPorHora;
    // --- FIN CÁLCULO DE COSTO EN BACKEND ---

    // 6. Insertar la reserva con el costo calculado por el backend
    const nuevaReservaQuery = `
      INSERT INTO Reservas (
        espacio_id, cliente_nombre, cliente_email, cliente_telefono,
        fecha_reserva, hora_inicio, hora_termino, costo_total, notas_adicionales
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *; 
    `;

    const values = [
      espacio_id, cliente_nombre, cliente_email, cliente_telefono,
      fecha_reserva, hora_inicio, hora_termino, costoTotalCalculado, // Usamos el costo calculado
      notas_adicionales
    ];

    const resultado = await pool.query(nuevaReservaQuery, values);

    res.status(201).json({
      mensaje: 'Reserva creada exitosamente.',
      reserva: resultado.rows[0]
    });

  } catch (err) {
    console.error("Error al crear la reserva:", err.message);
    console.error("Stack del error:", err.stack); // Para más detalle del error en la consola
    if (err.code === '23503') { // Error de foreign key violation (ej: espacio_id no existe)
      return res.status(400).json({ error: `El espacio_id ${req.body.espacio_id} no es válido o no existe.` });
    }
    // Considerar otros códigos de error de la BD si es necesario
    res.status(500).json({ error: 'Error del servidor al crear la reserva.' });
  }
});
// Ruta para MODIFICAR una reserva existente por su ID
// PUT /api/reservas/:id
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params; // ID de la reserva a actualizar
    const {
      cliente_nombre,
      cliente_email,
      cliente_telefono,
      notas_adicionales,
      estado_reserva, // Ej: 'confirmada', 'cancelada_por_admin', 'completada'
      estado_pago     // Ej: 'pagado', 'reembolsado'
      // No incluimos espacio_id, fecha_reserva, hora_inicio, hora_termino, costo_total
      // para esta actualización simple, ya que cambiar eso requiere lógica más compleja
      // (re-chequeo de disponibilidad, re-cálculo de costo).
    } = req.body;

    // Construir la parte SET de la consulta dinámicamente
    // para actualizar solo los campos que se envían en el body
    const camposAActualizar = [];
    const valoresAActualizar = [];
    let parametroIndex = 1;

    if (cliente_nombre !== undefined) {
      camposAActualizar.push(`cliente_nombre = $${parametroIndex++}`);
      valoresAActualizar.push(cliente_nombre);
    }
    if (cliente_email !== undefined) {
      camposAActualizar.push(`cliente_email = $${parametroIndex++}`);
      valoresAActualizar.push(cliente_email);
    }
    if (cliente_telefono !== undefined) {
      camposAActualizar.push(`cliente_telefono = $${parametroIndex++}`);
      valoresAActualizar.push(cliente_telefono);
    }
    if (notas_adicionales !== undefined) {
      camposAActualizar.push(`notas_adicionales = $${parametroIndex++}`);
      valoresAActualizar.push(notas_adicionales);
    }
    if (estado_reserva !== undefined) {
      camposAActualizar.push(`estado_reserva = $${parametroIndex++}`);
      valoresAActualizar.push(estado_reserva);
    }
    if (estado_pago !== undefined) {
      camposAActualizar.push(`estado_pago = $${parametroIndex++}`);
      valoresAActualizar.push(estado_pago);
    }

    if (camposAActualizar.length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos para actualizar.' });
    }

    // El trigger que creamos en la BD se encargará de actualizar 'actualizado_en'
    // Si no tuvieras el trigger, añadirías: camposAActualizar.push(`actualizado_en = CURRENT_TIMESTAMP`);

    const updateQuery = `
      UPDATE Reservas
      SET ${camposAActualizar.join(', ')}
      WHERE id = $${parametroIndex}
      RETURNING *;
    `;

    valoresAActualizar.push(id); // Añadir el ID al final para el WHERE

    const resultado = await pool.query(updateQuery, valoresAActualizar);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada para actualizar.' });
    }

    res.status(200).json({
      mensaje: 'Reserva actualizada exitosamente.',
      reserva: resultado.rows[0]
    });

  } catch (err) {
    console.error(`Error al actualizar la reserva ${req.params.id}:`, err.message);
    console.error("Stack del error:", err.stack);
    if (isNaN(parseInt(req.params.id, 10))) {
        return res.status(400).json({ error: 'El ID de la reserva debe ser un número.' });
    }
    res.status(500).json({ error: 'Error del servidor al actualizar la reserva.' });
  }
});

// Ruta para CANCELAR una reserva (Borrado Lógico)
// DELETE /api/reservas/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params; // ID de la reserva a cancelar

    // Podríamos permitir enviar un estado específico de cancelación en el body si quisiéramos,
    // ej: req.body.nuevo_estado_reserva o determinar si es cancelada por admin o cliente.
    // Por ahora, asumiremos una cancelación genérica que establece el estado.
    const nuevoEstado = 'cancelada_por_admin'; // O el estado que definas para cancelaciones

    // El trigger que creamos en la BD se encargará de actualizar 'actualizado_en'
    const cancelarReservaQuery = `
      UPDATE Reservas
      SET estado_reserva = $1
      WHERE id = $2
      RETURNING *; 
    `; // También podríamos añadir SET actualizado_en = CURRENT_TIMESTAMP si no tuvieras el trigger

    const values = [nuevoEstado, id];
    const resultado = await pool.query(cancelarReservaQuery, values);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada para cancelar.' });
    }

    res.status(200).json({
      mensaje: 'Reserva cancelada exitosamente.',
      reserva: resultado.rows[0] // Devuelve la reserva con su nuevo estado
    });

  } catch (err) {
    console.error(`Error al cancelar la reserva ${req.params.id}:`, err.message);
    console.error("Stack del error:", err.stack);
    if (isNaN(parseInt(req.params.id, 10))) {
        return res.status(400).json({ error: 'El ID de la reserva debe ser un número.' });
    }
    res.status(500).json({ error: 'Error del servidor al cancelar la reserva.' });
  }
});

module.exports = router;