// Archivo: routes/reservas.routes.js (Versión Final y Corregida)

const express = require('express');
const router = express.Router();
const pool = require('../db');
const checkAuth = require('../middleware/check-auth');
const { 
  enviarEmailSolicitudRecibida,
  enviarEmailReservaConfirmada,
  enviarEmailCancelacionCliente, 
  enviarEmailCancelacionAdmin,
  enviarEmailNotificacionAdminNuevaSolicitud // Importar la nueva función
} = require('../services/email.service');
const { validarHorasSocio, calcularDesgloseCostos } = require('../services/booking.service.js'); // Actualizado a calcularDesgloseCostos
const { parseISO, format, isValid } = require('date-fns');

// ----------------------------------------------------------------
// RUTA PÚBLICA para consultar disponibilidad
// ----------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { fecha, espacio_id, mes } = req.query;
    let queryText = `SELECT id, espacio_id, fecha_reserva, hora_inicio, hora_termino, estado_reserva FROM "reservas"`;
    const queryParams = [];
    const whereClauses = [];
    let paramIndex = 1;

    // Add the mandatory filter for reservation status
    // No parameters needed for this part of the clause, so paramIndex is not incremented here.
    whereClauses.push(`estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin')`);

    if (espacio_id) { whereClauses.push(`espacio_id = $${paramIndex++}`); queryParams.push(espacio_id); }
    if (fecha) { whereClauses.push(`fecha_reserva = $${paramIndex++}`); queryParams.push(fecha); }
    if (mes) {
      const [year, month] = mes.split('-').map(Number);
      if (year && month) {
        whereClauses.push(`EXTRACT(YEAR FROM fecha_reserva) = $${paramIndex++}`); queryParams.push(year);
        whereClauses.push(`EXTRACT(MONTH FROM fecha_reserva) = $${paramIndex++}`); queryParams.push(month);
      }
    }
    if (whereClauses.length > 0) { queryText += ' WHERE ' + whereClauses.join(' AND '); }
    queryText += ' ORDER BY fecha_reserva ASC, hora_inicio ASC;';
    console.log('Executing query for GET /reservas:', queryText);
    console.log('Query parameters for GET /reservas:', queryParams);
    const resultado = await pool.query(queryText, queryParams);
    console.log(`GET /reservas: Found ${resultado.rowCount} rows. First few results (if any):`, JSON.stringify(resultado.rows.slice(0, 5), null, 2)); // Log first 5 rows
    res.status(200).json(resultado.rows);
  } catch (err) {
    console.error("Error al obtener las reservas públicas:", err.message);
    res.status(500).json({ error: 'Error del servidor al obtener las reservas.' });
  }
});

// ----------------------------------------------------------------
// RUTA PÚBLICA para crear una nueva reserva (LÓGICA FUSIONADA)
// ----------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const {
      espacio_id, cliente_nombre, cliente_email, cliente_telefono,
      fecha_reserva: fecha_reserva_input, hora_inicio, hora_termino,
      notas_adicionales, rut_socio,
      // Nuevos campos de facturación
      tipo_documento, facturacion_rut, facturacion_razon_social,
      facturacion_direccion, facturacion_giro,
      // Campos del cupón
      cupon_id, // Cambiado de cupon_aplicado_id para coincidir con lo que envía el frontend
      monto_descuento_aplicado // Este valor del frontend se ignora, el backend recalcula el descuento
    } = req.body;

    // Validate and format fecha_reserva_input
    let fecha_reserva_cleaned;
    try {
      const parsedDate = parseISO(fecha_reserva_input);
      if (!isValid(parsedDate)) {
        return res.status(400).json({ error: 'Formato de fecha_reserva inválido o fecha no válida.' });
      }
      fecha_reserva_cleaned = format(parsedDate, 'yyyy-MM-dd');
    } catch (parseError) {
      console.error('Error parsing fecha_reserva_input:', parseError);
      return res.status(400).json({ error: 'Error al procesar fecha_reserva.' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_reserva_cleaned)) {
        return res.status(400).json({ error: 'Formato final de fecha_reserva inválido después de procesar.' });
    }

    if (!espacio_id || !cliente_nombre || !cliente_email || !fecha_reserva_cleaned || !hora_inicio || !hora_termino) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para la reserva.' });
    }

    const chequeoDisponibilidadQuery = `SELECT id FROM "reservas" WHERE espacio_id = $1 AND fecha_reserva = $2 AND (hora_inicio < $4 AND hora_termino > $3) AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin');`;
    const resultadoChequeo = await pool.query(chequeoDisponibilidadQuery, [espacio_id, fecha_reserva_cleaned, hora_inicio, hora_termino]);
    if (resultadoChequeo.rowCount > 0) {
      return res.status(409).json({ error: 'El espacio ya está reservado para el horario solicitado.' });
    }
    
    // Actualizar para seleccionar los nuevos nombres de columna de precios netos
    const espacioResult = await pool.query('SELECT id, nombre, precio_neto_por_hora, precio_neto_socio_por_hora FROM "espacios" WHERE id = $1', [espacio_id]);
    if (espacioResult.rowCount === 0) {
      return res.status(404).json({ error: `Espacio con id ${espacio_id} no encontrado.` });
    }
    const espacio = espacioResult.rows[0];
    const duracionReserva = parseInt(hora_termino.split(':')[0]) - parseInt(hora_inicio.split(':')[0]);

    let socioId = null;
    let isSocioBooking = false;

    if (rut_socio) {
      const validacionSocio = await validarHorasSocio(rut_socio, fecha_reserva_cleaned, duracionReserva);
      if (!validacionSocio.success) {
        return res.status(validacionSocio.status).json({ error: validacionSocio.error });
      }
      socioId = validacionSocio.socioId;
      isSocioBooking = true;
    }

    // SE ELIMINÓ UNA LLAVE DE CIERRE '}' EXTRA AQUÍ

    // ----- INICIO LÓGICA DE CUPÓN Y COSTOS -----
    // 'monto_descuento_aplicado' del req.body se ignora. Solo se usa 'cupon_id'.
    console.log('[POST /reservas] Datos de cupón recibidos del frontend:', { cupon_id });


    let montoDescuentoFinalBackend = 0;
    // Usar cupon_id (que es el que realmente llega del frontend) para la lógica de re-validación.
    // idCuponValidoParaGuardar almacenará el ID del cupón si es válido y se aplica.
    let idCuponValidoParaGuardar = null;

    // 1. Calcular el costo neto base de la reserva (sin ningún descuento de cupón aún)
    const calculoNetoBase = calcularDesgloseCostos(espacio, duracionReserva, isSocioBooking, 0); // montoDescuentoCupon = 0
    if (calculoNetoBase.error || isNaN(calculoNetoBase.costoNetoBase)) {
        console.error('[POST /reservas] Error al calcular costoNetoBaseReserva:', calculoNetoBase.error);
        return res.status(500).json({ error: `Error al calcular el costo base de la reserva.` });
    }
    const costoNetoBaseReserva = calculoNetoBase.costoNetoBase;
    console.log('[POST /reservas] costoNetoBaseReserva (antes de cupón):', costoNetoBaseReserva);

    // 2. Re-validar el cupón si se proporcionó un cupon_id
    if (cupon_id) { // <--- Cambiado de cupon_aplicado_id a cupon_id
      console.log(`[POST /reservas] Re-validando cupón ID: ${cupon_id} para neto base: ${costoNetoBaseReserva}`);
      const cuponResult = await pool.query('SELECT * FROM cupones WHERE id = $1', [cupon_id]); // <--- Usar cupon_id

      if (cuponResult.rows.length > 0) {
        const cupon = cuponResult.rows[0];
        console.log('[POST /reservas] Cupón encontrado en BD:', cupon);

        let cuponEsValidoEnBackend = true;
        let motivoInvalidez = "";

        if (!cupon.activo) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = "Cupón inactivo.";
        }
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        if (cupon.fecha_validez_desde && hoy < new Date(cupon.fecha_validez_desde)) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = "Cupón aún no es válido.";
        }
        if (cupon.fecha_validez_hasta && hoy > new Date(cupon.fecha_validez_hasta)) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = "Cupón expirado.";
        }
        if (cupon.usos_maximos !== null && cupon.usos_actuales >= cupon.usos_maximos) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = "Cupón ha alcanzado límite de usos.";
        }
        if (costoNetoBaseReserva < parseFloat(cupon.monto_minimo_reserva_neto)) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = `No cumple monto mínimo de ${cupon.monto_minimo_reserva_neto}. Neto actual: ${costoNetoBaseReserva}`;
        }

        if (cuponEsValidoEnBackend) {
          console.log('[POST /reservas] Cupón es VÁLIDO en backend.');
          if (cupon.tipo_descuento === 'porcentaje') {
            montoDescuentoFinalBackend = (costoNetoBaseReserva * parseFloat(cupon.valor_descuento)) / 100;
          } else if (cupon.tipo_descuento === 'fijo') {
            montoDescuentoFinalBackend = parseFloat(cupon.valor_descuento);
          }
          montoDescuentoFinalBackend = Math.min(montoDescuentoFinalBackend, costoNetoBaseReserva); // No descontar más que el neto
          montoDescuentoFinalBackend = parseFloat(montoDescuentoFinalBackend.toFixed(2));
          idCuponValidoParaGuardar = cupon.id; // Confirmamos que este es el ID a guardar
          console.log('[POST /reservas] montoDescuentoFinalBackend calculado:', montoDescuentoFinalBackend);
        } else {
          console.warn(`[POST /reservas] Cupón ID ${cupon_id} NO FUE VÁLIDO en la re-validación del backend. Motivo: ${motivoInvalidez}. Procediendo sin descuento.`);
          // idCuponValidoParaGuardar se queda como null, montoDescuentoFinalBackend se queda en 0
        }
      } else {
        console.warn(`[POST /reservas] Cupón ID ${cupon_id} (enviado por frontend) no encontrado en BD durante re-validación. Procediendo sin descuento.`);
        // idCuponValidoParaGuardar se queda como null, montoDescuentoFinalBackend se queda en 0
      }
    } else {
      console.log('[POST /reservas] No se proporcionó cupon_id. Procediendo sin descuento de cupón.');
    }

    // 3. Calcular el desglose final de costos usando el montoDescuentoFinalBackend (que será 0 si no hubo cupón válido)
    const desgloseCostosFinal = calcularDesgloseCostos(espacio, duracionReserva, isSocioBooking, montoDescuentoFinalBackend);
    console.log('[POST /reservas] desgloseCostosFinal:', desgloseCostosFinal);

    if (desgloseCostosFinal.error) {
      console.error('[POST /reservas] Error en desgloseCostosFinal:', desgloseCostosFinal.error);
      return res.status(500).json({ error: `Error al calcular el desglose final de costos: ${desgloseCostosFinal.error}` });
    }
    // ----- FIN LÓGICA DE CUPÓN Y COSTOS -----

    // Query para insertar la reserva
    const nuevaReservaQuery = `
      INSERT INTO "reservas" (
        espacio_id, cliente_nombre, cliente_email, cliente_telefono,
        fecha_reserva, hora_inicio, hora_termino,
        costo_neto_historico, costo_iva_historico, costo_total_historico,
        notas_adicionales, socio_id,
        -- Campos de facturación
        tipo_documento, facturacion_rut, facturacion_razon_social,
        facturacion_direccion, facturacion_giro,
        -- Campos de cupón
        cupon_aplicado_id, monto_descuento_aplicado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *;
    `;
    const values = [
      espacio_id, cliente_nombre, cliente_email, cliente_telefono,
      fecha_reserva_cleaned, hora_inicio, hora_termino,
      desgloseCostosFinal.costoNetoBase, // Guardar el neto ANTES del descuento del cupón
      desgloseCostosFinal.iva,           // IVA calculado sobre el neto DESPUÉS del descuento
      desgloseCostosFinal.total,         // Total final DESPUÉS del descuento y con IVA
      notas_adicionales, socioId,
      tipo_documento,
      tipo_documento === 'factura' ? facturacion_rut : null,
      tipo_documento === 'factura' ? facturacion_razon_social : null,
      tipo_documento === 'factura' ? facturacion_direccion : null,
      tipo_documento === 'factura' ? facturacion_giro : null,
      idCuponValidoParaGuardar, // Usar el ID del cupón validado (o null)
      montoDescuentoFinalBackend // Usar el monto de descuento calculado por el backend (o 0)
    ];
    console.log('[POST /reservas] Valores para INSERT en BD:', values);
    const resultado = await pool.query(nuevaReservaQuery, values);
    const reservaCreada = resultado.rows[0];
    console.log('[POST /reservas] Reserva creada en BD:', reservaCreada);
    
    // Incrementar usos_actuales del cupón si se aplicó uno y fue válido
    if (idCuponValidoParaGuardar && montoDescuentoFinalBackend > 0) {
      try {
        const updateCuponResult = await pool.query(
          'UPDATE cupones SET usos_actuales = usos_actuales + 1 WHERE id = $1 AND (usos_maximos IS NULL OR usos_actuales < usos_maximos)',
          [idCuponValidoParaGuardar]
        );
        if (updateCuponResult.rowCount > 0) {
          console.log(`[POST /reservas] Cupón ID ${idCuponValidoParaGuardar} actualizado, usos_actuales incrementado.`);
        } else {
          console.warn(`[POST /reservas] No se pudo incrementar el uso del cupón ID ${idCuponValidoParaGuardar} (quizás ya alcanzó límite o se desactivó).`);
        }
      } catch (errorCupon) {
        console.error(`[POST /reservas] Error al intentar actualizar usos del cupón ID ${idCuponValidoParaGuardar}:`, errorCupon);
      }
    }

    reservaCreada.nombre_espacio = espacio.nombre;
    // Los campos de costo ya están en reservaCreada desde RETURNING *.
    // El objeto `reservaCreada` se usará para los correos.

    await enviarEmailSolicitudRecibida(reservaCreada);

    const adminEmail = process.env.ADMIN_EMAIL_NOTIFICATIONS;
    if (adminEmail) {
      // Pasar el objeto reservaCreada que ya contiene los datos correctos de la BD
      await enviarEmailNotificacionAdminNuevaSolicitud(reservaCreada, adminEmail);
    } else {
      console.warn('[POST /reservas] ADMIN_EMAIL_NOTIFICATIONS no está configurado. No se enviará correo al administrador.');
    }

    res.status(201).json({ mensaje: 'Solicitud de reserva recibida. Por favor, realiza el pago para confirmar.', reserva: reservaCreada });

  } catch (err) {
    console.error("Error al crear la reserva:", err.message);
    if (err.code === '23503') { return res.status(400).json({ error: `El espacio_id proporcionado no es válido.` }); }
    res.status(500).json({ error: 'Error del servidor al crear la reserva.' });
  }
});


// ----------------------------------------------------------------
// RUTAS PROTEGIDAS (Solo para Administradores)
// ----------------------------------------------------------------

router.get('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const queryText = `SELECT r.*, e.nombre AS nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultado = await pool.query(queryText, [id]);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }
    res.status(200).json(resultado.rows[0]);
  } catch(err) {
    console.error(`Error al obtener reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor.'});
  }
});

router.put('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    let { estado_reserva, estado_pago } = req.body; // Usar let para poder modificar estado_pago

    if (estado_reserva === undefined && estado_pago === undefined) {
      return res.status(400).json({ error: 'No se proporcionaron campos válidos para actualizar.' });
    }

    // Lógica para auto-actualizar estado_pago si se confirma la reserva
    if (estado_reserva === 'confirmada') {
      estado_pago = 'pagado'; // Forzar estado_pago a 'pagado'
    }

    const camposAActualizar = [];
    const valoresAActualizar = [];
    let parametroIndex = 1;

    if (estado_reserva !== undefined) {
      camposAActualizar.push(`estado_reserva = $${parametroIndex++}`);
      valoresAActualizar.push(estado_reserva);
    }

    // Asegurarse de que estado_pago se actualice si se modificó automáticamente
    // o si vino explícitamente en la solicitud.
    if (estado_pago !== undefined) {
      // Si estado_reserva es 'confirmada', estado_pago ya fue forzado a 'pagado'.
      // Si estado_reserva no es 'confirmada', se usa el estado_pago que vino en el body (si vino).
      // Esta condición asegura que se añada a la query si hay un valor definido para estado_pago.
      camposAActualizar.push(`estado_pago = $${parametroIndex++}`);
      valoresAActualizar.push(estado_pago);
    }

    // Evitar query vacía si, por alguna razón, después de la lógica anterior no hay campos para actualizar
    // (aunque la validación inicial ya cubre que al menos uno debe venir).
    // Sin embargo, si estado_pago era el único campo y se volvió undefined, esto podría ser un problema.
    // La lógica actual de forzar estado_pago='pagado' cuando estado_reserva='confirmada' es más simple.
    // Si solo se envía estado_reserva='confirmada', estado_pago se añadirá.
    // Si se envía estado_pago='pendiente' y estado_reserva='confirmada', estado_pago se sobreescribirá a 'pagado'.

    if (camposAActualizar.length === 0) {
        // Esto podría ocurrir si solo se envió estado_pago y era 'pagado' y estado_reserva era 'confirmada'
        // y no hubo cambio real. O si la lógica se complica.
        // Por simplicidad, si no hay campos (lo cual es raro aquí), se podría retornar la reserva sin cambios.
        // Pero la validación inicial ya exige al menos un campo.
        // Una forma más robusta es obtener la reserva actual y solo actualizar si hay cambios reales.
        // Por ahora, asumimos que el frontend enviará cambios significativos o la validación inicial lo maneja.
         return res.status(400).json({ error: 'No hay campos válidos para actualizar después del procesamiento.' });
    }


    const updateQuery = `UPDATE "reservas" SET ${camposAActualizar.join(', ')} WHERE id = $${parametroIndex} RETURNING *;`;
    valoresAActualizar.push(id);
    const resultado = await pool.query(updateQuery, valoresAActualizar);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada para actualizar.' });
    }

    const reservaActualizadaQuery = `SELECT r.*, e.nombre as nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultadoFinal = await pool.query(reservaActualizadaQuery, [id]);
    const reservaActualizadaConNombreEspacio = resultadoFinal.rows[0];

    // Lógica de envío de correos basada en el estado_reserva que efectivamente se guardó.
    // Usar reservaActualizadaConNombreEspacio.estado_reserva que es el valor final en la BD.
    if (reservaActualizadaConNombreEspacio.estado_reserva === 'confirmada') {
      // Solo enviar si el estado ANTES de esta actualización NO ERA 'confirmada' para evitar reenvíos.
      // Esto requiere obtener el estado previo o asumir que el frontend no permite "reconfirmar" sin sentido.
      // Por ahora, se envía siempre que el estado final sea 'confirmada'.
      await enviarEmailReservaConfirmada(reservaActualizadaConNombreEspacio);
    } else if (reservaActualizadaConNombreEspacio.estado_reserva === 'cancelada_por_admin') {
      await enviarEmailCancelacionAdmin(reservaActualizadaConNombreEspacio);
    } else if (reservaActualizadaConNombreEspacio.estado_reserva === 'cancelada_por_cliente') {
      // Este estado usualmente lo actualiza el cliente, pero si el admin lo fuerza.
      await enviarEmailCancelacionCliente(reservaActualizadaConNombreEspacio);
    }

    res.status(200).json({ mensaje: 'Reserva actualizada exitosamente.', reserva: reservaActualizadaConNombreEspacio });
  } catch (err) {
    console.error(`Error al actualizar la reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor al actualizar la reserva.' });
  }
});

router.delete('/:id', checkAuth, async (req, res) => {
  // --- CORRECCIÓN: Se añade la llave de apertura del 'try' ---
  try {
    const { id } = req.params;
    const nuevoEstado = 'cancelada_por_admin';
    const cancelarReservaQuery = `UPDATE "reservas" SET estado_reserva = $1 WHERE id = $2 RETURNING *;`;
    const resultadoUpdate = await pool.query(cancelarReservaQuery, [nuevoEstado, id]);
    if (resultadoUpdate.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada para cancelar.' });
    }
    const reservaCanceladaQuery = `SELECT r.*, e.nombre as nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultadoFinal = await pool.query(reservaCanceladaQuery, [id]);
    const reservaCancelada = resultadoFinal.rows[0];
    await enviarEmailCancelacionAdmin(reservaCancelada);
    res.status(200).json({ mensaje: 'Reserva cancelada exitosamente.', reserva: reservaCancelada });
  } catch (err) {
    console.error(`Error al cancelar la reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor al cancelar la reserva.' });
  }
});

module.exports = router;
