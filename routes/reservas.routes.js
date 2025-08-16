// Archivo: routes/reservas.routes.js (CON CORRECCIONES PROPUESTAS)

const express = require('express');
const router = express.Router();
const pool = require('../db');
const checkAuth = require('../middleware/check-auth');
const {
  enviarEmailSolicitudRecibida,
  enviarEmailReservaConfirmada,
  enviarEmailCancelacionCliente,
  enviarEmailCancelacionAdmin,
  enviarEmailNotificacionAdminNuevaSolicitud,
} = require('../services/email.service');
const {
  validarHorasSocio,
  calcularDesgloseCostos,
} = require('../services/booking.service.js');
const {
  parseISO,
  format,
  isValid,
  addDays,
  eachDayOfInterval,
  isEqual,
  getDay,
  startOfMonth,
  endOfMonth,
} = require('date-fns'); // Asegurar getDay

// ----------------------------------------------------------------
// RUTA PÚBLICA para consultar disponibilidad (SIN CAMBIOS EN ESTA SECCIÓN)
// ----------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { fecha, espacio_id, mes } = req.query;
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

    whereClauses.push(
      `estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin', 'rechazada')`
    );

    if (espacio_id) {
      whereClauses.push(`espacio_id = $${paramIndex++}`);
      queryParams.push(espacio_id);
    }

    if (fecha) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res
          .status(400)
          .json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
      }
      whereClauses.push(`fecha_reserva <= $${paramIndex}`);
      whereClauses.push(`COALESCE(end_date, fecha_reserva) >= $${paramIndex}`);
      queryParams.push(fecha);
      paramIndex++;
    } else if (mes) {
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res
          .status(400)
          .json({ error: 'Formato de mes inválido. Use YYYY-MM.' });
      }
      const [year, monthStr] = mes.split('-');
      const month = parseInt(monthStr, 10);
      const firstDayOfMonth = format(
        startOfMonth(new Date(parseInt(year, 10), month - 1, 1)),
        'yyyy-MM-dd'
      );
      const lastDayOfMonth = format(
        endOfMonth(new Date(parseInt(year, 10), month - 1, 1)),
        'yyyy-MM-dd'
      );
      whereClauses.push(`fecha_reserva <= $${paramIndex++}`);
      queryParams.push(lastDayOfMonth);
      whereClauses.push(
        `COALESCE(end_date, fecha_reserva) >= $${paramIndex++}`
      );
      queryParams.push(firstDayOfMonth);
    }

    if (whereClauses.length > 0) {
      queryText += ' WHERE ' + whereClauses.join(' AND ');
    }
    queryText += ' ORDER BY fecha_reserva ASC, hora_inicio ASC;';
    const resultado = await pool.query(queryText, queryParams);
    res.status(200).json(resultado.rows);
  } catch (err) {
    console.error(
      'Error al obtener las reservas públicas:',
      err.message,
      err.stack
    );
    res
      .status(500)
      .json({ error: 'Error del servidor al obtener las reservas.' });
  }
});

// ----------------------------------------------------------------
// RUTA PÚBLICA para crear una nueva reserva (LÓGICA MODIFICADA)
// ----------------------------------------------------------------
router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      espacio_id,
      cliente_nombre,
      cliente_email,
      cliente_telefono,
      fecha_reserva: fecha_reserva_input,
      fecha_fin_reserva: fecha_fin_reserva_input,
      dias_discretos,
      hora_inicio,
      hora_termino,
      notas_adicionales,
      rut_socio,
      tipo_documento,
      facturacion_rut,
      facturacion_razon_social,
      facturacion_direccion,
      facturacion_giro,
      cupon_id,
      precio_total_enviado_cliente, // Leer este campo
      metodo_pago, // Leer el nuevo campo
    } = req.body;

    if (
      !espacio_id ||
      !cliente_nombre ||
      !cliente_email ||
      !fecha_reserva_input ||
      !hora_inicio ||
      !hora_termino
    ) {
      return res.status(400).json({
        error:
          'Faltan campos obligatorios para la reserva (espacio, cliente, fecha inicio, horas).',
      });
    }

    let startDate;
    try {
      const parsedStartDate = parseISO(fecha_reserva_input);
      if (!isValid(parsedStartDate))
        throw new Error('Fecha de inicio inválida.');
      startDate = format(parsedStartDate, 'yyyy-MM-dd');
    } catch (e) {
      return res
        .status(400)
        .json({ error: `Formato de fecha_reserva inválido: ${e.message}` });
    }

    let endDate; // Este será el end_date real para la BD si es un rango
    if (fecha_fin_reserva_input) {
      try {
        const parsedEndDate = parseISO(fecha_fin_reserva_input);
        if (!isValid(parsedEndDate)) throw new Error('Fecha de fin inválida.');
        if (isEqual(parsedEndDate, parseISO(startDate))) {
          // Si fecha_fin es igual a fecha_inicio, trátalo como día único
          endDate = null; // o no lo definas, para que luego finalEndDate sea startDate
        } else if (parsedEndDate < parseISO(startDate)) {
          return res.status(400).json({
            error:
              'La fecha de fin no puede ser anterior a la fecha de inicio.',
          });
        } else {
          endDate = format(parsedEndDate, 'yyyy-MM-dd');
        }
      } catch (e) {
        return res.status(400).json({
          error: `Formato de fecha_fin_reserva inválido: ${e.message}`,
        });
      }
    }

    let discreteDatesCleaned = [];
    if (dias_discretos && dias_discretos.length > 0) {
      if (fecha_fin_reserva_input) {
        // No permitir ambos
        return res.status(400).json({
          error:
            'No se puede especificar fecha_fin_reserva y dias_discretos simultáneamente.',
        });
      }
      endDate = null; // Asegurar que no haya un endDate si son días discretos
      try {
        for (const d of dias_discretos) {
          const parsedDiscreteDate = parseISO(d);
          if (!isValid(parsedDiscreteDate))
            throw new Error(`Fecha discreta inválida: ${d}`);
          discreteDatesCleaned.push(format(parsedDiscreteDate, 'yyyy-MM-dd'));
        }
        discreteDatesCleaned = [...new Set(discreteDatesCleaned)].sort();
      } catch (e) {
        return res.status(400).json({
          error: `Error en el formato de dias_discretos: ${e.message}`,
        });
      }
    }

    const datesToVerify = [];
    if (discreteDatesCleaned.length > 0) {
      datesToVerify.push(...discreteDatesCleaned);
    } else if (endDate) {
      // Es un rango de múltiples días (endDate ya validado > startDate)
      const interval = { start: parseISO(startDate), end: parseISO(endDate) };
      eachDayOfInterval(interval).forEach((d) =>
        datesToVerify.push(format(d, 'yyyy-MM-dd'))
      );
    } else {
      // Día único
      datesToVerify.push(startDate);
    }

    if (datesToVerify.length === 0) {
      return res
        .status(400)
        .json({ error: 'No se especificaron fechas para la reserva.' });
    }

    await client.query('BEGIN');

    for (const dateToCheck of datesToVerify) {
      const availabilityQuery = `
        SELECT id FROM "reservas"
        WHERE espacio_id = $1
        AND (
          (fecha_reserva <= $2 AND COALESCE(end_date, fecha_reserva) >= $2)
        )
        AND hora_inicio < $4 AND hora_termino > $3
        AND estado_reserva NOT IN ('cancelada_por_cliente', 'cancelada_por_admin', 'rechazada');
      `;
      const availabilityResult = await client.query(availabilityQuery, [
        espacio_id,
        dateToCheck,
        hora_inicio,
        hora_termino,
      ]);
      if (availabilityResult.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `El espacio ya está reservado para el horario solicitado el día ${dateToCheck}. ID conflicto: ${availabilityResult.rows[0].id}`,
        });
      }

      const blockedDateQuery = `SELECT id FROM "blocked_dates" WHERE date = $1;`;
      const blockedDateResult = await client.query(blockedDateQuery, [
        dateToCheck,
      ]);
      if (blockedDateResult.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `El día ${dateToCheck} está bloqueado y no se puede reservar.`,
        });
      }
    }

    const espacioResult = await client.query(
      'SELECT id, nombre, precio_neto_por_hora, precio_neto_socio_por_hora FROM "espacios" WHERE id = $1',
      [espacio_id]
    );
    if (espacioResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: `Espacio con id ${espacio_id} no encontrado.` });
    }
    const espacio = espacioResult.rows[0];
    const duracionReservaHoras =
      parseInt(hora_termino.split(':')[0]) -
      parseInt(hora_inicio.split(':')[0]);
    if (duracionReservaHoras <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'La hora de término debe ser posterior a la hora de inicio.',
      });
    }

    let socioId = null;
    let isSocioBooking = false;
    if (rut_socio) {
      const fechaParaValidarSocio = datesToVerify[0];
      const validacionSocio = await validarHorasSocio(
        rut_socio,
        fechaParaValidarSocio,
        duracionReservaHoras,
        client
      );
      if (!validacionSocio.success) {
        await client.query('ROLLBACK');
        return res
          .status(validacionSocio.status)
          .json({ error: validacionSocio.error });
      }
      socioId = validacionSocio.socioId;
      isSocioBooking = true;
    }

    // --- Lógica de Cupón y Costos (MODIFICADA SIGNIFICATIVAMENTE) ---
    let montoDescuentoFinalBackend = 0;
    let idCuponValidoParaGuardar = null;
    let costoNetoTotalParaReserva;
    let ivaTotalParaReserva;
    let costoTotalFinalParaReserva;

    const desgloseCostosPorSlotSinDescuento = calcularDesgloseCostos(
      espacio,
      duracionReservaHoras,
      isSocioBooking,
      0
    );
    if (
      desgloseCostosPorSlotSinDescuento.error ||
      isNaN(desgloseCostosPorSlotSinDescuento.costoNetoBase)
    ) {
      await client.query('ROLLBACK');
      console.error(
        '[POST /reservas] Error al calcular costoNetoBaseReserva por slot:',
        desgloseCostosPorSlotSinDescuento.error
      );
      return res.status(500).json({
        error: `Error al calcular el costo base de la reserva por slot.`,
      });
    }
    const costoNetoBasePorSlot =
      desgloseCostosPorSlotSinDescuento.costoNetoBase;

    let costoNetoTotalAntesDeCupon;
    let numeroDeSlotsFacturables = 0;

    if (discreteDatesCleaned.length > 0) {
      // Para días discretos, considerar si deben ser solo días hábiles o si los fines de semana tienen costo $0 o se excluyen.
      // Por ahora, contamos todos los días discretos proporcionados.
      numeroDeSlotsFacturables = discreteDatesCleaned.length;
      costoNetoTotalAntesDeCupon =
        costoNetoBasePorSlot * numeroDeSlotsFacturables;
    } else if (endDate) {
      // Rango de múltiples días
      const diasDelRango = eachDayOfInterval({
        start: parseISO(startDate),
        end: parseISO(endDate),
      });
      let diasHabiles = 0;
      for (const dia of diasDelRango) {
        const dayOfWeek = getDay(dia);
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          // Lunes a Viernes
          diasHabiles++;
        }
      }
      if (diasHabiles === 0 && diasDelRango.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error:
            'El rango seleccionado no contiene días hábiles (Lunes a Viernes) facturables.',
        });
      }
      numeroDeSlotsFacturables = diasHabiles;
      costoNetoTotalAntesDeCupon =
        costoNetoBasePorSlot * numeroDeSlotsFacturables;
    } else {
      // Día único
      numeroDeSlotsFacturables = 1; // Asumimos que un día único es facturable (si no es fin de semana y la política lo indica, se ajustaría aquí)
      // Por ahora, si es un día único, se cobra.
      costoNetoTotalAntesDeCupon = costoNetoBasePorSlot;
    }

    if (numeroDeSlotsFacturables === 0) {
      await client.query('ROLLBACK');
      // discreteDatesCleaned.length > 0 ya fue manejado arriba si este es el caso.
      // Esto cubre el caso de un rango que solo tenía fines de semana.
      return res
        .status(400)
        .json({ error: 'No se encontraron días facturables para la reserva.' });
    }

    if (cupon_id) {
      const cuponResult = await client.query(
        'SELECT * FROM cupones WHERE id = $1',
        [cupon_id]
      );
      if (cuponResult.rows.length > 0) {
        const cupon = cuponResult.rows[0];
        let cuponEsValidoEnBackend = true;
        let motivoInvalidez = '';
        if (!cupon.activo) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = 'Cupón inactivo.';
        }
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        if (
          cupon.fecha_validez_desde &&
          hoy < new Date(cupon.fecha_validez_desde)
        ) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = 'Cupón aún no es válido.';
        }
        if (
          cupon.fecha_validez_hasta &&
          hoy > new Date(cupon.fecha_validez_hasta)
        ) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = 'Cupón expirado.';
        }
        if (
          cupon.usos_maximos !== null &&
          cupon.usos_actuales >= cupon.usos_maximos
        ) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = 'Cupón ha alcanzado el límite de usos.';
        }
        if (
          costoNetoTotalAntesDeCupon <
          parseFloat(cupon.monto_minimo_reserva_neto)
        ) {
          cuponEsValidoEnBackend = false;
          motivoInvalidez = `El neto total de la reserva (${costoNetoTotalAntesDeCupon}) no cumple el monto mínimo del cupón de ${cupon.monto_minimo_reserva_neto}.`;
        }

        // --- NUEVA VALIDACIÓN: Un solo uso por socio (configurable) ---
        if (cupon.un_solo_uso_por_socio && socioId) {
          const usoPrevioQuery = await client.query(
            'SELECT id FROM reservas WHERE socio_id = $1 AND cupon_aplicado_id = $2 LIMIT 1',
            [socioId, cupon.id]
          );
          if (usoPrevioQuery.rowCount > 0) {
            cuponEsValidoEnBackend = false;
            motivoInvalidez =
              'Este cupón es de un solo uso y ya ha sido utilizado por este socio.';
          }
        }
        // --- FIN NUEVA VALIDACIÓN ---

        if (cuponEsValidoEnBackend) {
          if (cupon.tipo_descuento === 'porcentaje') {
            montoDescuentoFinalBackend =
              (costoNetoTotalAntesDeCupon * parseFloat(cupon.valor_descuento)) /
              100;
          } else if (cupon.tipo_descuento === 'fijo') {
            montoDescuentoFinalBackend = parseFloat(cupon.valor_descuento);
          }
          montoDescuentoFinalBackend = Math.min(
            montoDescuentoFinalBackend,
            costoNetoTotalAntesDeCupon
          );
          montoDescuentoFinalBackend = parseFloat(
            montoDescuentoFinalBackend.toFixed(2)
          );
          idCuponValidoParaGuardar = cupon.id;
        } else {
          console.warn(
            `[POST /reservas] Cupón ID ${cupon_id} NO FUE VÁLIDO. Motivo: ${motivoInvalidez}.`
          );
        }
      } else {
        console.warn(`[POST /reservas] Cupón ID ${cupon_id} no encontrado.`);
      }
    }

    costoNetoTotalParaReserva =
      costoNetoTotalAntesDeCupon - montoDescuentoFinalBackend;
    const TASA_IVA = 0.19;
    ivaTotalParaReserva = parseFloat(
      (costoNetoTotalParaReserva * TASA_IVA).toFixed(2)
    );
    costoTotalFinalParaReserva =
      costoNetoTotalParaReserva + ivaTotalParaReserva;

    if (precio_total_enviado_cliente !== undefined) {
      const diferenciaPrecio = Math.abs(
        parseFloat(precio_total_enviado_cliente) - costoTotalFinalParaReserva
      );
      if (diferenciaPrecio > 1) {
        console.warn(
          `[POST /reservas] Discrepancia de precios. Cliente envió: ${precio_total_enviado_cliente}, Backend calculó: ${costoTotalFinalParaReserva}. Diferencia: ${diferenciaPrecio}`
        );
        // Considerar si esto debe ser un error que impida la reserva. Por ahora solo log.
        // await client.query('ROLLBACK');
        // return res.status(400).json({ error: `Discrepancia en el precio calculado. Frontend: ${precio_total_enviado_cliente}, Backend: ${costoTotalFinalParaReserva}. Por favor, intente de nuevo.` });
      }
    }

    const nuevaReservaQuery = `
      INSERT INTO "reservas" (
        espacio_id, cliente_nombre, cliente_email, cliente_telefono,
        fecha_reserva, end_date, hora_inicio, hora_termino,
        costo_total,
        costo_neto_historico, costo_iva_historico, costo_total_historico,
        notas_adicionales, socio_id,
        tipo_documento, facturacion_rut, facturacion_razon_social,
        facturacion_direccion, facturacion_giro,
        cupon_aplicado_id, monto_descuento_aplicado,
        estado_reserva, estado_pago
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 'pendiente', 'pendiente')
      RETURNING *;
    `;

    const reservasCreadas = [];

    if (discreteDatesCleaned.length > 0) {
      let descuentoPorSlot = 0;
      if (numeroDeSlotsFacturables > 0 && montoDescuentoFinalBackend > 0) {
        descuentoPorSlot = parseFloat(
          (montoDescuentoFinalBackend / numeroDeSlotsFacturables).toFixed(2)
        );
      }

      for (const discreteDate of discreteDatesCleaned) {
        // Calcular costo para este slot discreto específico, aplicando su porción de descuento
        const desgloseEsteSlot = calcularDesgloseCostos(
          espacio,
          duracionReservaHoras,
          isSocioBooking,
          descuentoPorSlot
        );

        const values = [
          espacio_id,
          cliente_nombre,
          cliente_email,
          cliente_telefono,
          discreteDate,
          discreteDate,
          hora_inicio,
          hora_termino,
          desgloseEsteSlot.total, // costo_total
          desgloseEsteSlot.costoNetoBase, // costo_neto_historico
          desgloseEsteSlot.iva, // costo_iva_historico
          desgloseEsteSlot.total, // costo_total_historico
          notas_adicionales,
          socioId,
          tipo_documento,
          tipo_documento === 'factura' ? facturacion_rut : null,
          tipo_documento === 'factura' ? facturacion_razon_social : null,
          tipo_documento === 'factura' ? facturacion_direccion : null,
          tipo_documento === 'factura' ? facturacion_giro : null,
          idCuponValidoParaGuardar,
          descuentoPorSlot, // Monto del descuento aplicado a este slot específico
        ];
        const resultado = await client.query(nuevaReservaQuery, values);
        reservasCreadas.push(resultado.rows[0]);
      }
    } else {
      // Reserva de día único o rango
      const finalInsertEndDate = endDate ? endDate : startDate; // Si es día único, end_date es igual a startDate
      const values = [
        espacio_id,
        cliente_nombre,
        cliente_email,
        cliente_telefono,
        startDate,
        finalInsertEndDate,
        hora_inicio,
        hora_termino,
        costoTotalFinalParaReserva, // costo_total
        costoNetoTotalParaReserva, // costo_neto_historico
        ivaTotalParaReserva, // costo_iva_historico
        costoTotalFinalParaReserva, // costo_total_historico
        notas_adicionales,
        socioId,
        tipo_documento,
        tipo_documento === 'factura' ? facturacion_rut : null,
        tipo_documento === 'factura' ? facturacion_razon_social : null,
        tipo_documento === 'factura' ? facturacion_direccion : null,
        tipo_documento === 'factura' ? facturacion_giro : null,
        idCuponValidoParaGuardar,
        montoDescuentoFinalBackend, // Descuento total aplicado a esta reserva (rango o única)
      ];
      const resultado = await client.query(nuevaReservaQuery, values);
      reservasCreadas.push(resultado.rows[0]);
    }

    if (idCuponValidoParaGuardar && montoDescuentoFinalBackend > 0) {
      // Incrementar uso del cupón UNA VEZ por transacción, independientemente de si crea 1 o N reservas.
      await client.query(
        'UPDATE cupones SET usos_actuales = usos_actuales + 1 WHERE id = $1 AND (usos_maximos IS NULL OR usos_actuales < usos_maximos)',
        [idCuponValidoParaGuardar]
      );
    }

    await client.query('COMMIT');

    if (reservasCreadas.length > 0) {
      const datosParaEmail = {
        ...reservasCreadas[0], // Base con ID, cliente_nombre, etc.
        nombre_espacio: espacio.nombre,
        fecha_reserva: startDate, // Fecha de inicio de la solicitud
        end_date: endDate, // Será null si no es un rango explícito o son días discretos
        dias_discretos_info:
          discreteDatesCleaned.length > 0 ? discreteDatesCleaned : null,

        // Componentes del costo total de la SOLICITUD para el email
        costo_total_solicitud: costoTotalFinalParaReserva,
        costo_neto_total_solicitud_o_equivalente: costoNetoTotalParaReserva,
        monto_descuento_total_solicitud_o_equivalente:
          montoDescuentoFinalBackend,
        iva_total_solicitud_o_equivalente: ivaTotalParaReserva,

        // Pasar también hora_inicio y hora_termino originales
        hora_inicio: hora_inicio,
        hora_termino: hora_termino,
      };

      // Si son días discretos, la `reserva[0]` individual tiene su propio costo.
      // Pero `datosParaEmail` ahora lleva los totales de la solicitud.
      // Y `dias_discretos_info` para que la plantilla itere.
      // `end_date` en `datosParaEmail` será el `endDate` del rango, o `null` para días discretos/único.

      // Solo enviar el correo con instrucciones de transferencia si ese fue el método elegido
      if (metodo_pago === 'transferencia') {
        await enviarEmailSolicitudRecibida(datosParaEmail);
        const adminEmail = process.env.ADMIN_EMAIL_NOTIFICATIONS;
        if (adminEmail) {
          await enviarEmailNotificacionAdminNuevaSolicitud(
            datosParaEmail,
            adminEmail
          );
        }
      }
    }

    res.status(201).json({
      mensaje:
        'Solicitud de reserva recibida exitosamente. Por favor, realiza el pago para confirmar.',
      reservas: reservasCreadas,
      costoTotalSolicitud: costoTotalFinalParaReserva,
      numeroDeSlotsFacturables: numeroDeSlotsFacturables,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('Error al crear la reserva:', err.stack);
    if (err.code === '23503') {
      return res.status(400).json({
        error: `El espacio_id proporcionado no es válido o hay otra referencia incorrecta.`,
      });
    }
    res.status(500).json({ error: 'Error del servidor al crear la reserva.' });
  } finally {
    if (client) client.release();
  }
});

// ----------------------------------------------------------------
// RUTAS PROTEGIDAS (Solo para Administradores) - SIN CAMBIOS EN ESTA SECCIÓN
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
  } catch (err) {
    console.error(`Error al obtener reserva ${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

router.put('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    let { estado_reserva, estado_pago } = req.body; // Usar let para poder modificar estado_pago

    if (estado_reserva === undefined && estado_pago === undefined) {
      return res.status(400).json({
        error: 'No se proporcionaron campos válidos para actualizar.',
      });
    }

    // --- Lógica de Cancelación (añadida para flexibilidad) ---
    // Si el frontend envía una cancelación a través de PUT, la manejamos aquí
    // para evitar un error 404 si el frontend debería haber usado DELETE.
    if (estado_reserva === 'cancelada_por_admin') {
      const cancelarReservaQuery = `UPDATE "reservas" SET estado_reserva = $1 WHERE id = $2 RETURNING *;`;
      const resultadoUpdate = await pool.query(cancelarReservaQuery, [
        estado_reserva,
        id,
      ]);
      if (resultadoUpdate.rowCount === 0) {
        return res
          .status(404)
          .json({ error: 'Reserva no encontrada para cancelar.' });
      }
      const reservaCanceladaQuery = `SELECT r.*, e.nombre as nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1`;
      const resultadoFinal = await pool.query(reservaCanceladaQuery, [id]);
      const reservaCancelada = resultadoFinal.rows[0];
      await enviarEmailCancelacionAdmin(reservaCancelada);
      return res.status(200).json({
        mensaje: 'Reserva cancelada exitosamente (vía PUT).',
        reserva: reservaCancelada,
      });
    }
    // --- Fin Lógica de Cancelación ---

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
      return res.status(400).json({
        error:
          'No hay campos válidos para actualizar después del procesamiento.',
      });
    }

    const updateQuery = `UPDATE "reservas" SET ${camposAActualizar.join(
      ', '
    )} WHERE id = $${parametroIndex} RETURNING *;`;
    valoresAActualizar.push(id);
    const resultado = await pool.query(updateQuery, valoresAActualizar);

    if (resultado.rowCount === 0) {
      return res
        .status(404)
        .json({ error: 'Reserva no encontrada para actualizar.' });
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
    } else if (
      reservaActualizadaConNombreEspacio.estado_reserva ===
      'cancelada_por_admin'
    ) {
      await enviarEmailCancelacionAdmin(reservaActualizadaConNombreEspacio);
    } else if (
      reservaActualizadaConNombreEspacio.estado_reserva ===
      'cancelada_por_cliente'
    ) {
      // Este estado usualmente lo actualiza el cliente, pero si el admin lo fuerza.
      await enviarEmailCancelacionCliente(reservaActualizadaConNombreEspacio);
    }

    res.status(200).json({
      mensaje: 'Reserva actualizada exitosamente.',
      reserva: reservaActualizadaConNombreEspacio,
    });
  } catch (err) {
    console.error(
      `Error al actualizar la reserva ${req.params.id}:`,
      err.message
    );
    res
      .status(500)
      .json({ error: 'Error del servidor al actualizar la reserva.' });
  }
});

router.delete('/:id', checkAuth, async (req, res) => {
  // --- CORRECCIÓN: Se añade la llave de apertura del 'try' ---
  try {
    const { id } = req.params;
    const nuevoEstado = 'cancelada_por_admin';
    const cancelarReservaQuery = `UPDATE "reservas" SET estado_reserva = $1 WHERE id = $2 RETURNING *;`;
    const resultadoUpdate = await pool.query(cancelarReservaQuery, [
      nuevoEstado,
      id,
    ]);
    if (resultadoUpdate.rowCount === 0) {
      return res
        .status(404)
        .json({ error: 'Reserva no encontrada para cancelar.' });
    }
    const reservaCanceladaQuery = `SELECT r.*, e.nombre as nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1`;
    const resultadoFinal = await pool.query(reservaCanceladaQuery, [id]);
    const reservaCancelada = resultadoFinal.rows[0];
    await enviarEmailCancelacionAdmin(reservaCancelada);
    res.status(200).json({
      mensaje: 'Reserva cancelada exitosamente.',
      reserva: reservaCancelada,
    });
  } catch (err) {
    console.error(
      `Error al cancelar la reserva ${req.params.id}:`,
      err.message
    );
    res
      .status(500)
      .json({ error: 'Error del servidor al cancelar la reserva.' });
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
    const reservaQueryResult = await pool.query(
      'SELECT r.*, e.nombre as nombre_espacio FROM "reservas" r JOIN "espacios" e ON r.espacio_id = e.id WHERE r.id = $1',
      [reservaId]
    );
    if (reservaQueryResult.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }
    const reserva = reservaQueryResult.rows[0];

    // 1.1. Autorización: Verificar si el usuario autenticado es el dueño de la reserva
    // Esto es una capa básica. Si los administradores también pueden iniciar pagos, la lógica necesitaría ajustarse.
    // O si checkAuth ya valida roles de admin que pueden acceder a todo.
    if (
      req.userData &&
      req.userData.role !== 'admin' &&
      reserva.cliente_email !== clienteEmail
    ) {
      console.warn(
        `[INICIAR PAGO] Intento no autorizado por usuario ${clienteEmail} para reserva ${reservaId} perteneciente a ${reserva.cliente_email}`
      );
      return res.status(403).json({
        error: 'No está autorizado para iniciar el pago de esta reserva.',
      });
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
      console.log(
        `[INICIAR PAGO] Intento de pago para reserva ${reservaId} en estado no válido: ${reserva.estado_reserva}`
      );
      return res.status(400).json({
        error: `La reserva no está en un estado válido para iniciar el pago. Estado actual: ${reserva.estado_reserva}`,
      });
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
    console.log(
      `[INICIAR PAGO] Reserva ID: ${reservaId}. Estado actualizado a 'pago_iniciado'. ID de preferencia simulada: ${idPreferenciaSimulada}`
    );
    // ***** FIN SECCIÓN SIMULADA *****

    res.status(200).json({
      mensaje: 'Proceso de pago iniciado. Redirigiendo a la pasarela de pago.',
      reservaId: reserva.id,
      urlPago: urlPagoSimulada, // Enviar la URL de pago real (e.g., mpResponse.init_point)
      idPreferencia: idPreferenciaSimulada, // Enviar el ID de preferencia real (e.g., mpResponse.id)
    });
  } catch (err) {
    console.error(
      `[INICIAR PAGO ERROR] Reserva ID ${reservaId}:`,
      err.message,
      err.stack
    );
    res
      .status(500)
      .json({ error: 'Error del servidor al iniciar el proceso de pago.' });
  }
});

module.exports = router;
