// routes/pagos.routes.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { preference, payment } = require('../services/mercadopago.service.js');
const pool = require('../db.js');
const { enviarEmailReservaConfirmada } = require('../services/email.service.js');

/**
 * Función auxiliar para confirmar una reserva en la base de datos y enviar el email de confirmación.
 * Maneja su propia transacción de base de datos.
 * @param {string} reservaId El ID de la reserva a confirmar.
 * @returns {Promise<{success: boolean, message: string, status: number}>}
 */
async function confirmarReservaYEnviarEmail(reservaId) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Verificar si la reserva ya está confirmada para evitar acciones duplicadas
    const currentReserva = await client.query('SELECT estado_reserva FROM reservas WHERE id = $1', [reservaId]);
    if (currentReserva.rows.length > 0 && currentReserva.rows[0].estado_reserva === 'confirmada') {
      console.log(`La reserva ${reservaId} ya estaba confirmada.`);
      await client.query('COMMIT'); // Hacemos commit para cerrar la transacción de forma segura
      return { success: true, message: 'Reserva ya confirmada.', status: 200 };
    }

    // 2. Actualizar el estado de la reserva y el pago
    const updateQuery = 'UPDATE reservas SET estado_reserva = $1, estado_pago = $2 WHERE id = $3';
    await client.query(updateQuery, ['confirmada', 'pagado', reservaId]);

    // 3. Obtener los datos completos de la reserva para enviar el email
    const reservaCompletaQuery = `
      SELECT r.*, e.nombre AS nombre_espacio
      FROM reservas r
      JOIN espacios e ON r.espacio_id = e.id
      WHERE r.id = $1
    `;
    const resultadoFinal = await client.query(reservaCompletaQuery, [reservaId]);
    const reservaActualizada = resultadoFinal.rows[0];

    // 4. Enviar el email de confirmación
    if (reservaActualizada) {
      await enviarEmailReservaConfirmada(reservaActualizada);
      console.log(`Correo de confirmación enviado para la reserva ${reservaId}.`);
    }

    await client.query('COMMIT');
    console.log(`Reserva ${reservaId} actualizada y confirmada exitosamente.`);
    return { success: true, message: 'Reserva confirmada exitosamente.', status: 200 };

  } catch (dbError) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error(`Error de base de datos al confirmar la reserva ${reservaId}:`, dbError);
    return { success: false, message: 'Error de base de datos al actualizar la reserva.', status: 500 };
  } finally {
    if (client) {
      client.release();
    }
  }
}


// --- Endpoint para CREAR una preferencia de pago ---
// POST /pagos/crear-preferencia
router.post('/crear-preferencia', async (req, res) => {
  try {
    const { reservaId, titulo, precio } = req.body;

    if (!reservaId || !titulo || !precio) {
      return res.status(400).json({ error: 'Faltan detalles de la reserva (reservaId, titulo, precio).' });
    }

    // URLs a las que el usuario es redirigido después del pago
    // IMPORTANTE: Reemplazar con las URLs de tu frontend en producción
    const success_url = process.env.MP_SUCCESS_URL || 'http://localhost:5173/pago-exitoso';
    const failure_url = process.env.MP_FAILURE_URL || 'http://localhost:5173/pago-fallido';

    // URL para notificaciones de webhook
    // IMPORTANTE: Reemplazar con la URL pública de tu backend en producción
    const notification_url = process.env.MP_NOTIFICATION_URL || 'https://your-backend-url.onrender.com/pagos/webhook';

    const body = {
      items: [
        {
          id: reservaId,
          title: titulo,
          quantity: 1,
          unit_price: parseFloat(precio),
          currency_id: 'CLP', // OJO: Cambiar a la moneda de tu país si no es CLP
        },
      ],
      back_urls: {
        success: success_url,
        failure: failure_url,
        pending: failure_url, // Tratar pendiente como fallo por simplicidad
      },
      auto_return: 'approved',
      notification_url: notification_url,
    };

    const result = await preference.create({ body });

    res.status(201).json({
      id: result.id,
      init_point: result.init_point
    });

  } catch (error) {
    console.error('Error al crear la preferencia de pago:', error);
    res.status(500).json({ error: 'Error del servidor al crear la preferencia de pago.' });
  }
});

// --- Endpoint para RECIBIR notificaciones (Webhook) ---
// POST /pagos/webhook
router.post('/webhook', async (req, res) => {
  console.log('--- Notificación de Webhook recibida ---');
  const { type, data } = req.body;

  if (type === 'payment') {
    try {
      const paymentInfo = await payment.get({ id: data.id });
      console.log('--- Detalles del Pago Obtenidos ---', paymentInfo);

      if (paymentInfo.status === 'approved') {
        const reservaId = paymentInfo.metadata?.reserva_id || paymentInfo.items?.[0]?.id;
        if (reservaId) {
          console.log(`Pago aprobado para la reserva ID: ${reservaId}. Actualizando base de datos...`);
          // Usar la función auxiliar para manejar la lógica de la BD y el email
          const confirmacionResult = await confirmarReservaYEnviarEmail(reservaId);
          if (!confirmacionResult.success) {
            // Si la confirmación falla, MP debe reintentar. Devolvemos 500.
            return res.status(500).json({ error: confirmacionResult.message });
          }
        }
      }
    } catch (error) {
      console.error('Error al procesar el webhook:', error.message);
      // No se pudo obtener la info del pago, no es un error de BD, MP no debe reintentar.
      return res.status(200).json({ error: 'Error al obtener datos del pago.' });
    }
  }

  res.status(200).send('Webhook recibido.');
});


// --- Endpoint para PROCESAR un pago con tarjeta (API Checkout) ---
// POST /pagos/procesar-pago
router.post('/procesar-pago', async (req, res) => {
  try {
    const {
      token,
      issuer_id,
      payment_method_id,
      transaction_amount,
      installments,
      payer,
      reservaId
    } = req.body;

    if (!token || !transaction_amount || !installments || !payment_method_id || !payer || !reservaId) {
      return res.status(400).json({ error: 'Faltan datos requeridos para procesar el pago.' });
    }

    const payment_data = {
      transaction_amount: Number(transaction_amount),
      token: token,
      description: `Reserva de espacio ID: ${reservaId}`,
      installments: Number(installments),
      payment_method_id: payment_method_id,
      issuer_id: issuer_id,
      payer: {
        email: payer.email,
        identification: {
          type: payer.identification.type,
          number: payer.identification.number,
        },
      },
      metadata: {
        reserva_id: reservaId,
      }
    };

    const idempotencyKey = crypto.randomUUID();
    const requestOptions = { idempotencyKey };

    console.log(`Intentando procesar pago para reserva ID: ${reservaId}...`);
    const paymentResult = await payment.create({ body: payment_data, requestOptions });
    console.log('Respuesta de Mercado Pago:', paymentResult);

    // Si el pago es aprobado, confirmar la reserva en la BD
    if (paymentResult.status === 'approved') {
      const confirmacionResult = await confirmarReservaYEnviarEmail(reservaId);
      if (confirmacionResult.success) {
        return res.status(201).json({
          status: 'approved',
          message: 'Pago procesado y reserva confirmada exitosamente.',
          paymentId: paymentResult.id,
        });
      } else {
        // El pago se realizó, pero la BD falló. Esto es un estado crítico.
        console.error(`CRÍTICO: El pago ${paymentResult.id} fue aprobado pero la confirmación de la reserva ${reservaId} falló.`);
        return res.status(500).json({
          status: 'approved_but_confirmation_failed',
          message: 'El pago fue exitoso, pero ocurrió un error al confirmar la reserva.',
          paymentId: paymentResult.id,
        });
      }
    } else {
      // Si el pago no fue aprobado, devolver el estado y mensaje de MP
      return res.status(400).json({
        status: paymentResult.status,
        message: paymentResult.status_detail || 'El pago fue rechazado.',
        paymentId: paymentResult.id,
      });
    }

  } catch (error) {
    console.error('Error al procesar el pago:', error);
    if (error.cause) {
      return res.status(error.status || 500).json({ error: 'Error de Mercado Pago', cause: error.cause });
    }
    res.status(500).json({ error: 'Error del servidor al procesar el pago.' });
  }
});

module.exports = router;
