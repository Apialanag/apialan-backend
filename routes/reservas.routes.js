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
    } = req.body;

    if (
      !espacio_id ||
      !cliente_nombre ||
      !cliente_email ||
      !fecha_reserva_input ||
      !hora_inicio ||
      !hora_termino
    ) {
      return res
        .status(400)
        .json({
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
          return res
            .status(400)
            .json({
              error:
                'La fecha de fin no puede ser anterior a la fecha de inicio.',
            });
        } else {
          endDate = format(parsedEndDate, 'yyyy-MM-dd');
        }
      } catch (e) {
        return res
          .status(400)
          .json({
            error: `Formato de fecha_fin_reserva inválido: ${e.message}`,
          });
      }
    }

    let discreteDatesCleaned = [];
    if (dias_discretos && dias_discretos.length > 0) {
      if (fecha_fin_reserva_input) {
        // No permitir ambos
        return res
          .status(400)
          .json({
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
        return res
          .status(400)
          .json({
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
        return res
          .status(409)
          .json({
            error: `El espacio ya está reservado para el horario solicitado el día ${dateToCheck}. ID conflicto: ${availabilityResult.rows[0].id}`,
          });
      }

      const blockedDateQuery = `SELECT id FROM "blocked_dates" WHERE date = $1;`;
      const blockedDateResult = await client.query(blockedDateQuery, [
        dateToCheck,
      ]);
      if (blockedDateResult.rowCount > 0) {
        await client.query('ROLLBACK');
        return res
          .status(409)
          .json({
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
      return res
        .status(400)
        .json({
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
      return res
        .status(500)
        .json({
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
        return res
          .status(400)
          .json({
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

      await enviarEmailSolicitudRecibida(datosParaEmail);
      const adminEmail = process.env.ADMIN_EMAIL_NOTIFICATIONS;
      if (adminEmail) {
        await enviarEmailNotificacionAdminNuevaSolicitud(
          datosParaEmail,
          adminEmail
        );
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
      return res
        .status(400)
        .json({
          error: `El espacio_id proporcionado no es válido o hay otra referencia incorrecta.`,
        });
    }
    res.status(500).json({ error: 'Error del servidor al crear la reserva.' });
  } finally {
    if (client) client.release();
  }
});
