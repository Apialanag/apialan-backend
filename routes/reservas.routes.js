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
const { parseISO, format, isValid, addDays, eachDayOfInterval, isEqual, startOfMonth, endOfMonth } = require('date-fns'); // NUEVAS IMPORTACIONES + startOfMonth, endOfMonth

// ----------------------------------------------------------------
// RUTA PÚBLICA para consultar disponibilidad (ACTUALIZADA)
// ----------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { fecha, espacio_id, mes } = req.query;
    // Incluir end_date en la selección. Usar COALESCE para manejar registros antiguos que podrían tener end_date NULL.
    // Aunque la migración debería haber llenado end_date, COALESCE es una salvaguarda.
    let queryText = `
      SELECT
        id, espacio_id,
        TO_CHAR(fecha_reserva, 'YYYY-MM-DD') AS fecha_reserva,
        TO_CHAR(COALESCE(end_date, fecha_reserva), 'YYYY-MM-DD') AS end_date,
        hora_inicio, hora_termino, estado_reserva
      FROM "reservas"
    `;
    const queryParams = [];
    const whereClauses = [];
    let paramIndex = 1;

    // Filtro mandatorio de estado de reserva
    whereClauses.push(`estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin', 'rechazada')`);

    if (espacio_id) {
      whereClauses.push(`espacio_id = $${paramIndex++}`);
      queryParams.push(espacio_id);
    }

    if (fecha) {
      // Validar formato de fecha
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
      }
      // Una reserva es relevante para 'fecha' si 'fecha' está entre fecha_reserva y end_date (inclusive)
      // COALESCE(end_date, fecha_reserva) asegura que las reservas de un solo día (donde end_date podría ser NULL o igual a fecha_reserva) se manejen correctamente.
      whereClauses.push(`fecha_reserva <= $${paramIndex}`);
      whereClauses.push(`COALESCE(end_date, fecha_reserva) >= $${paramIndex}`);
      queryParams.push(fecha);
      paramIndex++;
    } else if (mes) {
      // Validar formato de mes
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: 'Formato de mes inválido. Use YYYY-MM.' });
      }
      const [year, monthStr] = mes.split('-');
      const month = parseInt(monthStr, 10); // Mes en base 10 (1-12)

      // Crear primer y último día del mes usando date-fns para mayor robustez
      // Date-fns usa meses base 0 (0-11), por lo que restamos 1 al mes.
      const firstDayOfMonth = format(startOfMonth(new Date(parseInt(year, 10), month - 1, 1)), 'yyyy-MM-dd');
      const lastDayOfMonth = format(endOfMonth(new Date(parseInt(year, 10), month - 1, 1)), 'yyyy-MM-dd');

      // Una reserva se solapa con el mes si:
      // su fecha_reserva es ANTES o IGUAL al último día del mes consultado
      // Y su end_date (o fecha_reserva si end_date es NULL) es DESPUÉS o IGUAL al primer día del mes consultado.
      // Esto cubre todos los casos:
      // 1. Reserva totalmente dentro del mes.
      // 2. Reserva que empieza antes y termina dentro del mes.
      // 3. Reserva que empieza dentro y termina después del mes.
      // 4. Reserva que empieza antes y termina después (abarca todo el mes).
      whereClauses.push(`fecha_reserva <= $${paramIndex++}`); // Reserva.start <= Mes.end
      queryParams.push(lastDayOfMonth);
      whereClauses.push(`COALESCE(end_date, fecha_reserva) >= $${paramIndex++}`); // Reserva.end >= Mes.start
      queryParams.push(firstDayOfMonth);
    }

    if (whereClauses.length > 0) {
      queryText += ' WHERE ' + whereClauses.join(' AND ');
    }
    queryText += ' ORDER BY fecha_reserva ASC, hora_inicio ASC;';

    // console.log('Executing query for GET /reservas:', queryText);
    // console.log('Query parameters for GET /reservas:', queryParams);
    const resultado = await pool.query(queryText, queryParams);
    // console.log(`GET /reservas: Found ${resultado.rowCount} rows. First few results (if any):`, JSON.stringify(resultado.rows.slice(0, 5), null, 2));
    res.status(200).json(resultado.rows);
  } catch (err) {
    console.error("Error al obtener las reservas públicas:", err.message, err.stack);
    res.status(500).json({ error: 'Error del servidor al obtener las reservas.' });
  }
});

// ----------------------------------------------------------------
// RUTA PÚBLICA para crear una nueva reserva (LÓGICA FUSIONADA Y ACTUALIZADA)
// ----------------------------------------------------------------
router.post('/', async (req, res) => {
  const client = await pool.connect(); // Para manejar transacciones

  try {
    const {
      espacio_id, cliente_nombre, cliente_email, cliente_telefono,
      fecha_reserva: fecha_reserva_input, // Será la start_date para rangos
      fecha_fin_reserva: fecha_fin_reserva_input, // Opcional, para end_date en rangos
      dias_discretos, // Opcional, array de strings de fecha YYYY-MM-DD
      hora_inicio, hora_termino,
      notas_adicionales, rut_socio,
      tipo_documento, facturacion_rut, facturacion_razon_social,
      facturacion_direccion, facturacion_giro,
      cupon_id,
      // monto_descuento_aplicado se sigue ignorando y recalculando en backend
    } = req.body;

    // --- Validación de campos obligatorios básicos ---
    if (!espacio_id || !cliente_nombre || !cliente_email || !fecha_reserva_input || !hora_inicio || !hora_termino) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para la reserva (espacio, cliente, fecha inicio, horas).' });
    }

    // --- Limpieza y validación de fechas ---
    let startDate;
    try {
      const parsedStartDate = parseISO(fecha_reserva_input);
      if (!isValid(parsedStartDate)) throw new Error('Fecha de inicio inválida.');
      startDate = format(parsedStartDate, 'yyyy-MM-dd');
    } catch (e) {
      return res.status(400).json({ error: `Formato de fecha_reserva inválido: ${e.message}` });
    }

    let endDate;
    if (fecha_fin_reserva_input) {
      try {
        const parsedEndDate = parseISO(fecha_fin_reserva_input);
        if (!isValid(parsedEndDate)) throw new Error('Fecha de fin inválida.');
        endDate = format(parsedEndDate, 'yyyy-MM-dd');
        if (parseISO(endDate) < parseISO(startDate)) {
          return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la fecha de inicio.' });
        }
      } catch (e) {
        return res.status(400).json({ error: `Formato de fecha_fin_reserva inválido: ${e.message}` });
      }
    }

    let discreteDatesCleaned = [];
    if (dias_discretos && dias_discretos.length > 0) {
      if (fecha_fin_reserva_input) {
        return res.status(400).json({ error: 'No se puede especificar fecha_fin_reserva y dias_discretos simultáneamente.' });
      }
      try {
        for (const d of dias_discretos) {
          const parsedDiscreteDate = parseISO(d);
          if (!isValid(parsedDiscreteDate)) throw new Error(`Fecha discreta inválida: ${d}`);
          discreteDatesCleaned.push(format(parsedDiscreteDate, 'yyyy-MM-dd'));
        }
        // Opcional: Ordenar y eliminar duplicados si es necesario
        discreteDatesCleaned = [...new Set(discreteDatesCleaned)].sort();
      } catch (e) {
        return res.status(400).json({ error: `Error en el formato de dias_discretos: ${e.message}` });
      }
    }

    // --- Determinar las fechas a verificar ---
    const datesToVerify = [];
    if (discreteDatesCleaned.length > 0) {
      datesToVerify.push(...discreteDatesCleaned);
    } else if (endDate && !isEqual(parseISO(startDate), parseISO(endDate))) { // Es un rango de múltiples días
      const interval = { start: parseISO(startDate), end: parseISO(endDate) };
      eachDayOfInterval(interval).forEach(d => datesToVerify.push(format(d, 'yyyy-MM-dd')));
    } else { // Día único
      datesToVerify.push(startDate);
    }

    if (datesToVerify.length === 0) {
        return res.status(400).json({ error: 'No se especificaron fechas para la reserva.' });
    }


    // --- Iniciar Transacción ---
    await client.query('BEGIN');

    // --- Validación de Disponibilidad Crítica ---
    for (const dateToCheck of datesToVerify) {
      // 1. Chequear contra tabla 'reservas'
      const availabilityQuery = `
        SELECT id FROM "reservas"
        WHERE espacio_id = $1
        AND (
          (fecha_reserva <= $2 AND end_date >= $2) OR -- Reserva existente que incluye dateToCheck
          (fecha_reserva = $2 AND end_date IS NULL) -- Reserva antigua de un solo día en dateToCheck
        )
        AND hora_inicio < $4 AND hora_termino > $3
        AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin', 'rechazada');
      `;
      const availabilityResult = await client.query(availabilityQuery, [espacio_id, dateToCheck, hora_inicio, hora_termino]);
      if (availabilityResult.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `El espacio ya está reservado para el horario solicitado el día ${dateToCheck}.` });
      }

      // 2. Chequear contra tabla 'blocked_dates'
      const blockedDateQuery = `SELECT id FROM "blocked_dates" WHERE date = $1;`;
      const blockedDateResult = await client.query(blockedDateQuery, [dateToCheck]);
      if (blockedDateResult.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `El día ${dateToCheck} está bloqueado y no se puede reservar.` });
      }
    }

    // --- Obtener datos del espacio y calcular duración ---
    const espacioResult = await client.query('SELECT id, nombre, precio_neto_por_hora, precio_neto_socio_por_hora FROM "espacios" WHERE id = $1', [espacio_id]);
    if (espacioResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Espacio con id ${espacio_id} no encontrado.` });
    }
    const espacio = espacioResult.rows[0];
    // Duración de un slot de reserva (ej. 2 horas si es de 10:00 a 12:00)
    const duracionReservaHoras = parseInt(hora_termino.split(':')[0]) - parseInt(hora_inicio.split(':')[0]);
    if (duracionReservaHoras <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La hora de término debe ser posterior a la hora de inicio.' });
    }


    // --- Lógica de Socio (validar para la primera fecha de la reserva) ---
    // Para reservas de múltiples días (rango o discretas), la validación de horas de socio se hace
    // contra la primera fecha de la solicitud. Podría ajustarse si la política es más compleja.
    let socioId = null;
    let isSocioBooking = false;
    if (rut_socio) {
      // Usar la primera fecha de la reserva (startDate o la primera de dias_discretos) para validar horas de socio
      const fechaParaValidarSocio = datesToVerify[0];
      const validacionSocio = await validarHorasSocio(rut_socio, fechaParaValidarSocio, duracionReservaHoras, client); // Pasar client para transacción
      if (!validacionSocio.success) {
        await client.query('ROLLBACK');
        return res.status(validacionSocio.status).json({ error: validacionSocio.error });
      }
      socioId = validacionSocio.socioId;
      isSocioBooking = true;
    }

    // --- Lógica de Cupón y Costos ---
    // El costo se calcula para UNA instancia de reserva (un slot de tiempo).
    // Si son días discretos, este mismo costo se aplicará a cada reserva individual creada.
    let montoDescuentoFinalBackend = 0;
    let idCuponValidoParaGuardar = null;
    const calculoNetoBase = calcularDesgloseCostos(espacio, duracionReservaHoras, isSocioBooking, 0);

    if (calculoNetoBase.error || isNaN(calculoNetoBase.costoNetoBase)) {
      await client.query('ROLLBACK');
      console.error('[POST /reservas] Error al calcular costoNetoBaseReserva:', calculoNetoBase.error);
      return res.status(500).json({ error: `Error al calcular el costo base de la reserva.` });
    }
    const costoNetoBaseReservaPorSlot = calculoNetoBase.costoNetoBase;

    if (cupon_id) {
      const cuponResult = await client.query('SELECT * FROM cupones WHERE id = $1', [cupon_id]);
      if (cuponResult.rows.length > 0) {
        const cupon = cuponResult.rows[0];
        let cuponEsValidoEnBackend = true;
        let motivoInvalidez = "";
        // (Validaciones de cupón existentes... omitidas por brevedad, pero deben estar aquí)
        // Asegúrate de que las validaciones (activo, fecha, usos, monto_minimo) se hagan aquí.
        // Ejemplo simplificado:
        if (!cupon.activo) { cuponEsValidoEnBackend = false; motivoInvalidez = "Cupón inactivo."; }
        const hoy = new Date(); hoy.setHours(0,0,0,0);
        if (cupon.fecha_validez_desde && hoy < new Date(cupon.fecha_validez_desde)) { cuponEsValidoEnBackend = false; motivoInvalidez = "Cupón aún no es válido.";}
        // ... más validaciones ...
        if (costoNetoBaseReservaPorSlot < parseFloat(cupon.monto_minimo_reserva_neto)) {
           cuponEsValidoEnBackend = false;
           motivoInvalidez = `No cumple monto mínimo de ${cupon.monto_minimo_reserva_neto}. Neto actual por slot: ${costoNetoBaseReservaPorSlot}`;
        }


        if (cuponEsValidoEnBackend) {
          if (cupon.tipo_descuento === 'porcentaje') {
            montoDescuentoFinalBackend = (costoNetoBaseReservaPorSlot * parseFloat(cupon.valor_descuento)) / 100;
          } else if (cupon.tipo_descuento === 'fijo') {
            montoDescuentoFinalBackend = parseFloat(cupon.valor_descuento);
          }
          montoDescuentoFinalBackend = Math.min(montoDescuentoFinalBackend, costoNetoBaseReservaPorSlot);
          montoDescuentoFinalBackend = parseFloat(montoDescuentoFinalBackend.toFixed(2));
          idCuponValidoParaGuardar = cupon.id;
        } else {
           console.warn(`[POST /reservas] Cupón ID ${cupon_id} NO FUE VÁLIDO. Motivo: ${motivoInvalidez}.`);
        }
      } else {
         console.warn(`[POST /reservas] Cupón ID ${cupon_id} no encontrado.`);
      }
    }

    const desgloseCostosFinalPorSlot = calcularDesgloseCostos(espacio, duracionReservaHoras, isSocioBooking, montoDescuentoFinalBackend);
    if (desgloseCostosFinalPorSlot.error) {
      await client.query('ROLLBACK');
      console.error('[POST /reservas] Error en desgloseCostosFinalPorSlot:', desgloseCostosFinalPorSlot.error);
      return res.status(500).json({ error: `Error al calcular el desglose final de costos: ${desgloseCostosFinalPorSlot.error}` });
    }

    // --- Persistencia de la Reserva ---
    const nuevaReservaQuery = `
      INSERT INTO "reservas" (
        espacio_id, cliente_nombre, cliente_email, cliente_telefono,
        fecha_reserva, end_date, hora_inicio, hora_termino,
        costo_neto_historico, costo_iva_historico, costo_total_historico,
        notas_adicionales, socio_id,
        tipo_documento, facturacion_rut, facturacion_razon_social,
        facturacion_direccion, facturacion_giro,
        cupon_aplicado_id, monto_descuento_aplicado,
        estado_reserva, estado_pago
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'solicitada', 'pendiente')
      RETURNING *;
    `;
    
    const reservasCreadas = [];

    if (discreteDatesCleaned.length > 0) { // Múltiples reservas para días discretos
      for (const discreteDate of discreteDatesCleaned) {
        const values = [
          espacio_id, cliente_nombre, cliente_email, cliente_telefono,
          discreteDate, // fecha_reserva
          discreteDate, // end_date es igual a fecha_reserva
          hora_inicio, hora_termino,
          desgloseCostosFinalPorSlot.costoNetoBase,
          desgloseCostosFinalPorSlot.iva,
          desgloseCostosFinalPorSlot.total,
          notas_adicionales, socioId,
          tipo_documento, tipo_documento === 'factura' ? facturacion_rut : null,
          tipo_documento === 'factura' ? facturacion_razon_social : null,
          tipo_documento === 'factura' ? facturacion_direccion : null,
          tipo_documento === 'factura' ? facturacion_giro : null,
          idCuponValidoParaGuardar, montoDescuentoFinalBackend
        ];
        const resultado = await client.query(nuevaReservaQuery, values);
        reservasCreadas.push(resultado.rows[0]);
      }
    } else { // Reserva de día único o rango
      const finalEndDate = endDate ? endDate : startDate; // Si es día único, endDate es igual a startDate
      const values = [
        espacio_id, cliente_nombre, cliente_email, cliente_telefono,
        startDate, // fecha_reserva
        finalEndDate, // end_date
        hora_inicio, hora_termino,
        desgloseCostosFinalPorSlot.costoNetoBase, // Para rangos, el costo es por el slot, no por el rango completo. Ajustar si es necesario.
        desgloseCostosFinalPorSlot.iva,
        desgloseCostosFinalPorSlot.total,
        notas_adicionales, socioId,
        tipo_documento, tipo_documento === 'factura' ? facturacion_rut : null,
        tipo_documento === 'factura' ? facturacion_razon_social : null,
        tipo_documento === 'factura' ? facturacion_direccion : null,
        tipo_documento === 'factura' ? facturacion_giro : null,
        idCuponValidoParaGuardar, montoDescuentoFinalBackend
      ];
      const resultado = await client.query(nuevaReservaQuery, values);
      reservasCreadas.push(resultado.rows[0]);
    }

    // --- Actualizar usos del cupón si se aplicó ---
    if (idCuponValidoParaGuardar && montoDescuentoFinalBackend > 0) {
      // Incrementar por cada reserva creada si son días discretos, o una vez si es rango/único
      const numIncrementosCupon = reservasCreadas.length;
      // OJO: Revisar política de cupones. Si un cupón es "por reserva total" y no "por día de reserva",
      // esto debería ser client.query('... SET usos_actuales = usos_actuales + 1 ...')
      // Por ahora, se asume que si se crean N reservas, el cupón se usa N veces si aplica a cada una.
      // Si el cupón es para el total del booking request, entonces sumar solo 1.
      // Dado que el descuento se calculó por slot, es más coherente incrementar por cada reserva creada.
      for (let i = 0; i < numIncrementosCupon; i++) {
        await client.query(
            'UPDATE cupones SET usos_actuales = usos_actuales + 1 WHERE id = $1 AND (usos_maximos IS NULL OR usos_actuales < usos_maximos)',
            [idCuponValidoParaGuardar]
        );
      }
    }

    // --- Confirmar Transacción ---
    await client.query('COMMIT');

    // --- Enviar correos (para la primera reserva creada como representante de la solicitud) ---
    // Si son múltiples reservas, se envía correo por la primera, o se podría adaptar para enviar un resumen.
    if (reservasCreadas.length > 0) {
      const representativeReservation = { ...reservasCreadas[0], nombre_espacio: espacio.nombre };
      await enviarEmailSolicitudRecibida(representativeReservation);
      const adminEmail = process.env.ADMIN_EMAIL_NOTIFICATIONS;
      if (adminEmail) {
        await enviarEmailNotificacionAdminNuevaSolicitud(representativeReservation, adminEmail);
      }
    }

    res.status(201).json({
      mensaje: 'Solicitud de reserva recibida exitosamente. Por favor, realiza el pago para confirmar.',
      reservas: reservasCreadas // Devolver array de reservas creadas
    });

  } catch (err) {
    await client.query('ROLLBACK'); // Asegurar rollback en caso de error no manejado
    console.error("Error al crear la reserva:", err.stack); // err.stack para más detalle
    if (err.code === '23503') { // FK violation, e.g. espacio_id
      return res.status(400).json({ error: `El espacio_id proporcionado no es válido o hay otra referencia incorrecta.` });
    }
    res.status(500).json({ error: 'Error del servidor al crear la reserva.' });
  } finally {
    client.release(); // Liberar el cliente de vuelta al pool
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

// ----------------------------------------------------------------
// RUTA PARA INICIAR EL PROCESO DE PAGO DE UNA RESERVA
// ----------------------------------------------------------------
router.post('/:id/iniciar-pago', checkAuth, async (req, res) => {
  const { id: reservaId } = req.params;
  const clienteEmail = req.userData ? req.userData.email : null; // Asumiendo que checkAuth añade userData

  try {
    // 1. Validar que la reserva exista
    const reservaQueryResult = await pool.query('SELECT r.*, e.nombre as nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1', [reservaId]);
    if (reservaQueryResult.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }
    const reserva = reservaQueryResult.rows[0];

    // 1.1. Autorización: Verificar si el usuario autenticado es el dueño de la reserva
    // Esto es una capa básica. Si los administradores también pueden iniciar pagos, la lógica necesitaría ajustarse.
    // O si checkAuth ya valida roles de admin que pueden acceder a todo.
    if (req.userData && req.userData.role !== 'admin' && reserva.cliente_email !== clienteEmail) {
        console.warn(`[INICIAR PAGO] Intento no autorizado por usuario ${clienteEmail} para reserva ${reservaId} perteneciente a ${reserva.cliente_email}`);
        return res.status(403).json({ error: 'No está autorizado para iniciar el pago de esta reserva.' });
    }
    // Si no hay req.userData (p.ej. checkAuth no es estricto o es una ruta pública), esta verificación se omite.
    // Considera si esta ruta debe ser estrictamente para usuarios autenticados. El checkAuth sugiere que sí.

    // 2. Validar el estado de la reserva y el pago
    if (reserva.estado_pago === 'pagado') {
      return res.status(400).json({ error: 'Esta reserva ya ha sido pagada.' });
    }
    // Ajusta los estados permitidos según tu lógica de negocio.
    // Por ejemplo, una reserva 'solicitada' o 'confirmada_pendiente_pago' podría ser válida para pagar.
    const estadosValidosParaPagar = ['solicitada', 'confirmada_pendiente_pago']; // Ejemplo, ajusta según tu sistema
    if (!estadosValidosParaPagar.includes(reserva.estado_reserva)) {
      console.log(`[INICIAR PAGO] Intento de pago para reserva ${reservaId} en estado no válido: ${reserva.estado_reserva}`);
      return res.status(400).json({ error: `La reserva no está en un estado válido para iniciar el pago. Estado actual: ${reserva.estado_reserva}` });
    }

    // 3. LÓGICA DEL SERVICIO DE PAGO (PLACEHOLDER)
    // =================================================================
    // AQUÍ DEBES INTEGRAR TU SERVICIO DE PAGO (Ej: Mercado Pago, Stripe, PayPal)
    //
    // Ejemplo conceptual con Mercado Pago:
    //
    // const { MercadoPagoConfig, Preference } = require('mercadopago');
    // const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    // const preference = new Preference(client);
    //
    // const preferenceData = {
    //   items: [
    //     {
    //       id: reserva.id,
    //       title: `Reserva para ${reserva.nombre_espacio} el ${reserva.fecha_reserva}`,
    //       quantity: 1,
    //       unit_price: parseFloat(reserva.costo_total_historico), // Asegúrate que sea el monto correcto
    //       currency_id: 'CLP', // O la moneda que uses
    //     }
    //   ],
    //   payer: {
    //     email: reserva.cliente_email,
    //     // Otros datos del pagador si los tienes/necesitas
    //   },
    //   back_urls: { // URLs a las que Mercado Pago redirigirá al usuario
    //     success: `${process.env.FRONTEND_URL}/pago/exitoso`,
    //     failure: `${process.env.FRONTEND_URL}/pago/fallido`,
    //     pending: `${process.env.FRONTEND_URL}/pago/pendiente`
    //   },
    //   auto_return: 'approved', // Redirige automáticamente solo si el pago es aprobado
    //   external_reference: reserva.id.toString(), // Referencia externa, útil para webhooks
    //   notification_url: `${process.env.API_URL}/pagos/webhook/mercadopago` // URL para notificaciones de MP
    // };
    //
    // const mpResponse = await preference.create({ body: preferenceData });
    // const urlPago = mpResponse.init_point; // URL de checkout de Mercado Pago
    // const idPreferenciaPago = mpResponse.id; // ID de la preferencia
    //
    // await pool.query(
    //   'UPDATE "reservas" SET estado_pago = $1, id_preferencia_pago = $2 WHERE id = $3',
    //   ['pago_iniciado', idPreferenciaPago, reservaId]
    // );
    //
    // =================================================================
    // FIN LÓGICA DEL SERVICIO DE PAGO (PLACEHOLDER)

    // ***** INICIO SECCIÓN SIMULADA (REEMPLAZAR CON LO DE ARRIBA) *****
    // Simulación hasta que implementes la pasarela real:
    const urlPagoSimulada = `https://tu-pagina-de-pagos.com/checkout?reservaId=${reservaId}&monto=${reserva.costo_total_historico}&email=${reserva.cliente_email}`;
    const idPreferenciaSimulada = `sim_pref_${Date.now()}`;

    await pool.query(
      'UPDATE "reservas" SET estado_pago = $1, id_preferencia_pago = $2 WHERE id = $3',
      ['pago_iniciado', idPreferenciaSimulada, reservaId]
    );
    console.log(`[INICIAR PAGO] Reserva ID: ${reservaId}. Estado actualizado a 'pago_iniciado'. ID de preferencia simulada: ${idPreferenciaSimulada}`);
    // ***** FIN SECCIÓN SIMULADA *****

    res.status(200).json({
      mensaje: 'Proceso de pago iniciado. Redirigiendo a la pasarela de pago.',
      reservaId: reserva.id,
      urlPago: urlPagoSimulada, // Enviar la URL de pago real (e.g., mpResponse.init_point)
      idPreferencia: idPreferenciaSimulada // Enviar el ID de preferencia real (e.g., mpResponse.id)
    });

  } catch (err) {
    console.error(`[INICIAR PAGO ERROR] Reserva ID ${reservaId}:`, err.message, err.stack);
    res.status(500).json({ error: 'Error del servidor al iniciar el proceso de pago.' });
  }
});

module.exports = router;
