// routes/pagos.routes.js
const express = require('express');
const router = express.Router();
const { payment } = require('../services/mercadopago.service.js');
const pool = require('../db.js');

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
          unit_price: Number(precio),
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

    const preference = await payment.create({ body });

    res.status(201).json({
      id: preference.id,
      init_point: preference.init_point
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
      const paymentId = data.id;
      console.log(`Procesando notificación para el pago ID: ${paymentId}`);

      const paymentInfo = await payment.get({ id: paymentId });

      console.log('--- Detalles del Pago Obtenidos ---');
      console.log(paymentInfo);

      if (paymentInfo.status === 'approved') {
        const reservaId = paymentInfo.items[0]?.id;
        if (reservaId) {
          console.log(`Pago aprobado para la reserva ID: ${reservaId}. Actualizando base de datos...`);

          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            // Obtener el estado actual para evitar enviar correos múltiples
            const currentReserva = await client.query('SELECT estado_reserva FROM reservas WHERE id = $1', [reservaId]);
            if (currentReserva.rows.length > 0 && currentReserva.rows[0].estado_reserva === 'confirmada') {
              console.log(`La reserva ${reservaId} ya estaba confirmada. No se realizarán más acciones.`);
              await client.query('COMMIT');
              return res.status(200).send('Webhook procesado. Reserva ya confirmada.');
            }

            // Actualizar el estado de la reserva y el estado del pago
            const updateQuery = 'UPDATE reservas SET estado_reserva = $1, estado_pago = $2 WHERE id = $3';
            await client.query(updateQuery, ['confirmada', 'pagado', reservaId]);

            // Obtener los datos completos de la reserva para enviar el email
            const reservaCompletaQuery = `
              SELECT r.*, e.nombre AS nombre_espacio
              FROM reservas r
              JOIN espacios e ON r.espacio_id = e.id
              WHERE r.id = $1
            `;
            const resultadoFinal = await client.query(reservaCompletaQuery, [reservaId]);
            const reservaActualizada = resultadoFinal.rows[0];

            if (reservaActualizada) {
              const { enviarEmailReservaConfirmada } = require('../services/email.service.js');
              await enviarEmailReservaConfirmada(reservaActualizada);
              console.log(`Correo de confirmación enviado para la reserva ${reservaId}.`);
            }

            await client.query('COMMIT');
            console.log(`Reserva ${reservaId} actualizada y confirmada exitosamente.`);

          } catch (dbError) {
            await client.query('ROLLBACK');
            console.error('Error de base de datos al procesar el webhook:', dbError);
            // Devolvemos 500 para que Mercado Pago pueda reintentar la notificación.
            return res.status(500).json({ error: 'Error de base de datos al actualizar la reserva.' });
          } finally {
            client.release();
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

module.exports = router;
