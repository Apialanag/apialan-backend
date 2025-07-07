// Archivo: routes/cupones.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../db'); // Acceso a la base de datos
const { format, parseISO, isValid } = require('date-fns'); // Para manejar fechas y validarlas
const checkAuth = require('../middleware/check-auth'); // Middleware de autenticación

// Endpoint público para validar cupones (usado por clientes)
// Valida un código de cupón y calcula el descuento aplicable.
router.post('/validar', async (req, res) => {
  const { codigo_cupon, monto_neto_base_reserva } = req.body;

  if (!codigo_cupon || monto_neto_base_reserva === undefined) {
    return res.status(400).json({
      esValido: false,
      mensaje: 'El código de cupón y el monto neto base de la reserva son requeridos.',
    });
  }

  if (typeof monto_neto_base_reserva !== 'number' || monto_neto_base_reserva < 0) {
    return res.status(400).json({
      esValido: false,
      mensaje: 'El monto neto base de la reserva debe ser un número positivo.',
    });
  }

  try {
    const cuponResult = await pool.query('SELECT * FROM cupones WHERE codigo = $1', [codigo_cupon]);

    if (cuponResult.rows.length === 0) {
      return res.status(404).json({ esValido: false, mensaje: 'Cupón no encontrado.' });
    }

    const cupon = cuponResult.rows[0];

    // 1. Validar si el cupón está activo
    if (!cupon.activo) {
      return res.status(400).json({ esValido: false, mensaje: 'Este cupón ya no está activo.' });
    }

    // 2. Validar fechas de validez
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0); // Comparar solo fechas, ignorando la hora

    if (cupon.fecha_validez_desde) {
      const fechaDesde = new Date(cupon.fecha_validez_desde);
      if (hoy < fechaDesde) {
        return res.status(400).json({ esValido: false, mensaje: `Este cupón es válido a partir del ${format(fechaDesde, 'dd/MM/yyyy')}.` });
      }
    }
    if (cupon.fecha_validez_hasta) {
      const fechaHasta = new Date(cupon.fecha_validez_hasta);
      if (hoy > fechaHasta) {
        return res.status(400).json({ esValido: false, mensaje: 'Este cupón ha expirado.' });
      }
    }

    // 3. Validar usos máximos
    if (cupon.usos_maximos !== null && cupon.usos_actuales >= cupon.usos_maximos) {
      return res.status(400).json({ esValido: false, mensaje: 'Este cupón ha alcanzado su límite de usos.' });
    }

    // 4. Validar monto mínimo de reserva neto
    if (monto_neto_base_reserva < parseFloat(cupon.monto_minimo_reserva_neto)) {
      return res.status(400).json({
        esValido: false,
        mensaje: `Este cupón requiere un monto mínimo de reserva de ${parseFloat(cupon.monto_minimo_reserva_neto).toLocaleString('es-CL', {style: 'currency', currency: 'CLP'})} (neto).`
      });
    }

    // Si todas las validaciones pasan, calcular el descuento
    let montoDescontado = 0;
    let netoConDescuento = monto_neto_base_reserva;

    if (cupon.tipo_descuento === 'porcentaje') {
      montoDescontado = (monto_neto_base_reserva * parseFloat(cupon.valor_descuento)) / 100;
    } else if (cupon.tipo_descuento === 'fijo') {
      montoDescontado = parseFloat(cupon.valor_descuento);
    }

    // Asegurarse de que el descuento no sea mayor que el monto base
    montoDescontado = Math.min(montoDescontado, monto_neto_base_reserva);

    netoConDescuento = monto_neto_base_reserva - montoDescontado;

    // Redondear a 2 decimales por si acaso, aunque NUMERIC debería manejarlo bien.
    montoDescontado = parseFloat(montoDescontado.toFixed(2));
    netoConDescuento = parseFloat(netoConDescuento.toFixed(2));

    let mensajeExito = `Cupón '${cupon.codigo}' aplicado. `;
    if (cupon.tipo_descuento === 'porcentaje') {
        mensajeExito += `${parseFloat(cupon.valor_descuento)}% de descuento.`;
    } else {
        mensajeExito += `${montoDescontado.toLocaleString('es-CL', {style: 'currency', currency: 'CLP'})} de descuento.`;
    }


    return res.status(200).json({
      esValido: true,
      mensaje: mensajeExito,
      codigoCuponValidado: cupon.codigo,
      montoDescontado: montoDescontado,
      netoConDescuento: netoConDescuento,
      // Podríamos devolver también el ID del cupón para facilitar su uso en el siguiente paso de reserva
      cuponId: cupon.id
    });

  } catch (error) {
    console.error('Error al validar el cupón:', error);
    res.status(500).json({ esValido: false, mensaje: 'Error interno del servidor al validar el cupón.' });
  }
});


// Aplicar checkAuth a todas las rutas CRUD de administración de cupones que siguen
router.use(checkAuth);

// POST /cupones - Crear un nuevo cupón
router.post('/', async (req, res) => {
  const {
    codigo,
    tipo_descuento,
    valor_descuento,
    fecha_validez_desde, // YYYY-MM-DD
    fecha_validez_hasta, // YYYY-MM-DD
    usos_maximos,
    monto_minimo_reserva_neto,
    descripcion,
    activo = true // Default true si no se envía
  } = req.body;

  // Validaciones básicas
  if (!codigo || !tipo_descuento || valor_descuento === undefined) {
    return res.status(400).json({ error: 'Código, tipo de descuento y valor de descuento son requeridos.' });
  }
  if (!['porcentaje', 'fijo'].includes(tipo_descuento)) {
    return res.status(400).json({ error: "Tipo de descuento debe ser 'porcentaje' o 'fijo'." });
  }
  if (typeof valor_descuento !== 'number' || valor_descuento <= 0) {
    return res.status(400).json({ error: 'Valor de descuento debe ser un número positivo.' });
  }
  if (tipo_descuento === 'porcentaje' && (valor_descuento > 100)) { // Porcentaje no puede ser > 100
      return res.status(400).json({ error: 'Valor de descuento porcentual no puede exceder 100.' });
  }
  if (fecha_validez_desde && !isValid(parseISO(fecha_validez_desde))) {
    return res.status(400).json({ error: 'Fecha de validez desde no es válida.' });
  }
  if (fecha_validez_hasta && !isValid(parseISO(fecha_validez_hasta))) {
    return res.status(400).json({ error: 'Fecha de validez hasta no es válida.' });
  }
  if (fecha_validez_desde && fecha_validez_hasta && parseISO(fecha_validez_hasta) < parseISO(fecha_validez_desde)) {
    return res.status(400).json({ error: 'Fecha de validez hasta no puede ser anterior a la fecha desde.' });
  }


  try {
    const nuevoCupon = await pool.query(
      `INSERT INTO cupones (
        codigo, tipo_descuento, valor_descuento, fecha_validez_desde,
        fecha_validez_hasta, usos_maximos, monto_minimo_reserva_neto,
        descripcion, activo, usos_actuales
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0) RETURNING *`,
      [
        codigo.toUpperCase(), // Guardar código en mayúsculas para consistencia
        tipo_descuento,
        valor_descuento,
        fecha_validez_desde || null,
        fecha_validez_hasta || null,
        usos_maximos || null,
        monto_minimo_reserva_neto || 0,
        descripcion || null,
        activo
      ]
    );
    res.status(201).json(nuevoCupon.rows[0]);
  } catch (error) {
    console.error('Error al crear cupón:', error);
    if (error.code === '23505') { // Error de violación de unicidad (ej. código duplicado)
      return res.status(409).json({ error: 'El código de cupón ya existe.' });
    }
    res.status(500).json({ error: 'Error interno del servidor al crear el cupón.' });
  }
});

// GET /cupones - Leer todos los cupones (con paginación y filtro opcional por activo)
router.get('/', async (req, res) => {
  console.log('ADMIN DEBUG: Solicitud recibida en GET /cupones'); // Log de depuración
  const { page = 1, limit = 10, activo } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = 'SELECT * FROM cupones';
  const queryParams = [];
  const whereClauses = [];
  let paramIndex = 1;

  if (activo !== undefined) {
    whereClauses.push(`activo = $${paramIndex++}`);
    queryParams.push(activo === 'true');
  }

  if (whereClauses.length > 0) {
    query += ' WHERE ' + whereClauses.join(' AND ');
  }

  // Conteo total para paginación
  const countQuery = `SELECT COUNT(*) FROM cupones ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}`;

  query += ` ORDER BY fecha_creacion DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  queryParams.push(parseInt(limit));
  queryParams.push(offset);

  try {
    const totalResult = await pool.query(countQuery, queryParams.slice(0, whereClauses.length)); // Solo params de where para count
    const totalItems = parseInt(totalResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / parseInt(limit));

    const cuponesResult = await pool.query(query, queryParams);
    res.status(200).json({
      cupones: cuponesResult.rows,
      totalItems,
      totalPages,
      currentPage: parseInt(page),
    });
  } catch (error) {
    console.error('Error al obtener cupones:', error);
    res.status(500).json({ error: 'Error interno del servidor al obtener los cupones.' });
  }
});

// GET /cupones/:id - Leer un cupón específico
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const cuponResult = await pool.query('SELECT * FROM cupones WHERE id = $1', [id]);
    if (cuponResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cupón no encontrado.' });
    }
    res.status(200).json(cuponResult.rows[0]);
  } catch (error) {
    console.error(`Error al obtener cupón ${id}:`, error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// PUT /cupones/:id - Actualizar un cupón existente
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    codigo,
    tipo_descuento,
    valor_descuento,
    fecha_validez_desde,
    fecha_validez_hasta,
    usos_maximos,
    monto_minimo_reserva_neto,
    descripcion,
    activo,
    usos_actuales // Permitir ajustar usos actuales si es necesario, con precaución
  } = req.body;

  // Validaciones (similares a POST, pero adaptadas para PUT)
  if (tipo_descuento && !['porcentaje', 'fijo'].includes(tipo_descuento)) {
    return res.status(400).json({ error: "Tipo de descuento debe ser 'porcentaje' o 'fijo'." });
  }
  if (valor_descuento !== undefined && (typeof valor_descuento !== 'number' || valor_descuento <= 0)) {
    return res.status(400).json({ error: 'Valor de descuento debe ser un número positivo.' });
  }
   if (tipo_descuento === 'porcentaje' && valor_descuento !== undefined && (valor_descuento > 100)){
      return res.status(400).json({ error: 'Valor de descuento porcentual no puede exceder 100.'});
  }
  // ... más validaciones para fechas, etc. ...

  try {
    const fieldsToUpdate = {}; // ÚNICA declaración de los campos que vienen del body
    const directSetClauses = ["fecha_actualizacion = CURRENT_TIMESTAMP"];

    // Llenar fieldsToUpdate con los campos que vienen del req.body
    if (codigo !== undefined) fieldsToUpdate.codigo = codigo.toUpperCase();
    if (tipo_descuento !== undefined) fieldsToUpdate.tipo_descuento = tipo_descuento;
    if (valor_descuento !== undefined) fieldsToUpdate.valor_descuento = valor_descuento;
    if (fecha_validez_desde !== undefined) fieldsToUpdate.fecha_validez_desde = fecha_validez_desde || null;
    if (fecha_validez_hasta !== undefined) fieldsToUpdate.fecha_validez_hasta = fecha_validez_hasta || null;
    if (usos_maximos !== undefined) fieldsToUpdate.usos_maximos = usos_maximos || null;
    if (monto_minimo_reserva_neto !== undefined) fieldsToUpdate.monto_minimo_reserva_neto = monto_minimo_reserva_neto || 0;
    if (descripcion !== undefined) fieldsToUpdate.descripcion = descripcion || null;
    if (activo !== undefined) fieldsToUpdate.activo = activo;
    if (usos_actuales !== undefined) fieldsToUpdate.usos_actuales = usos_actuales;

    // Construir las cláusulas SET parametrizadas (a partir del único fieldsToUpdate)
    const parametrizedSetClauses = Object.keys(fieldsToUpdate).map((key, index) =>
      `${key} = $${index + 1}`
    );

    const allSetClauses = [...directSetClauses, ...parametrizedSetClauses];

    if (Object.keys(fieldsToUpdate).length === 0) {
      // No hay campos del body para actualizar, solo se actualizaría fecha_actualizacion.
      // Se podría permitir o devolver un error si se prefiere que siempre haya un cambio del body.
      // La lógica anterior devolvía error:
      return res.status(400).json({ error: 'No se proporcionaron campos (aparte de la fecha de actualización automática) para actualizar.' });
    }

    const finalSetClause = allSetClauses.join(', ');
    const values = Object.values(fieldsToUpdate);
    values.push(id);

    const query = `UPDATE cupones SET ${finalSetClause} WHERE id = $${values.length} RETURNING *`;

    const updatedCupon = await pool.query(query, values);

    if (updatedCupon.rows.length === 0) {
      return res.status(404).json({ error: 'Cupón no encontrado para actualizar.' });
    }
    res.status(200).json(updatedCupon.rows[0]);
  } catch (error) {
    console.error(`Error al actualizar cupón ${id}:`, error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El código de cupón ya existe para otro cupón.' });
    }
    res.status(500).json({ error: 'Error interno del servidor al actualizar el cupón.' });
  }
});

// DELETE /cupones/:id - Desactivar un cupón (borrado lógico)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const desactivarCupon = await pool.query(
      'UPDATE cupones SET activo = false, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );
    if (desactivarCupon.rows.length === 0) {
      return res.status(404).json({ error: 'Cupón no encontrado para desactivar.' });
    }
    res.status(200).json({ message: 'Cupón desactivado exitosamente.', cupon: desactivarCupon.rows[0] });
  } catch (error) {
    console.error(`Error al desactivar cupón ${id}:`, error);
    res.status(500).json({ error: 'Error interno del servidor al desactivar el cupón.' });
  }
});


module.exports = router;
