// Archivo: services/emailService.js

const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

// Configuración del "Transportador" que enviará los emails usando Gmail.
// Toma las credenciales de tu archivo .env
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // La contraseña de aplicación de 16 letras de Google
  },
});

// Helper functions for EJS templates
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
};

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
};

const formatTime = (timeString) => {
  return timeString.substring(0, 5);
};

// --- FUNCIÓN 1: EMAIL DE SOLICITUD DE RESERVA RECIBIDA (ACTUALIZADA) ---
/**
 * Envía un email inicial al cliente informando que su solicitud ha sido recibida
 * y está pendiente de pago.
 * @param {object} reserva - El objeto de la reserva creada.
 */
const enviarEmailSolicitudRecibida = async (reserva) => {
  try {
    const mailOptions = {
      from: `"Reservas Apialan" <${process.env.EMAIL_USER}>`,
      to: reserva.cliente_email,
      subject: `📄 Solicitud de Reserva Recibida (ID: ${reserva.id})`,
      html: await ejs.renderFile(
        path.join(__dirname, '../views/emails/solicitudRecibida.ejs'),
        {
          reserva: reserva,
          formatCurrency: formatCurrency,
          formatDate: formatDate,
          formatTime: formatTime
        }
      ),
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email de solicitud recibida enviado a ${reserva.cliente_email}`);
  } catch (error) {
    console.error(`Error al enviar email de solicitud para reserva ${reserva.id}:`, error);
  }
};


// --- FUNCIÓN 2: EMAIL DE RESERVA CONFIRMADA (TRAS EL PAGO) ---
const enviarEmailReservaConfirmada = async (reserva) => {
  try {
    const mailOptions = {
      from: `"Reservas Apialan" <${process.env.EMAIL_USER}>`,
      to: reserva.cliente_email,
      subject: `✅ ¡Tu reserva en Apialan está Confirmada! (ID: ${reserva.id})`,
      html: await ejs.renderFile(
        path.join(__dirname, '../views/emails/reservaConfirmada.ejs'),
        {
          reserva: reserva,
          formatCurrency: formatCurrency,
          formatDate: formatDate,
          formatTime: formatTime
        }
      ),
    };
    await transporter.sendMail(mailOptions);
    console.log(`Email de confirmación final enviado a ${reserva.cliente_email}`);
  } catch (error) {
    console.error(`Error al enviar email de confirmación para reserva ${reserva.id}:`, error);
  }
};


// --- FUNCIÓN 3: EMAIL DE CANCELACIÓN SOLICITADA POR EL CLIENTE ---
const enviarEmailCancelacionCliente = async (reserva) => {
  try {
    const mailOptions = {
      from: `"Reservas Apialan" <${process.env.EMAIL_USER}>`,
      to: reserva.cliente_email,
      subject: `✅ Confirmación de Cancelación de Reserva (ID: ${reserva.id})`,
      html: await ejs.renderFile(
        path.join(__dirname, '../views/emails/cancelacionCliente.ejs'),
        {
          reserva: reserva,
          formatCurrency: formatCurrency,
          formatDate: formatDate,
          formatTime: formatTime
        }
      ),
    };
    await transporter.sendMail(mailOptions);
    console.log(`Email de cancelación (solicitada por cliente) enviado a ${reserva.cliente_email}`);
  } catch (error) {
    console.error(`Error al enviar email de cancelación (cliente) para reserva ${reserva.id}:`, error);
  }
};


// --- FUNCIÓN 4: EMAIL DE CANCELACIÓN INICIADA POR EL ADMINISTRADOR ---
const enviarEmailCancelacionAdmin = async (reserva) => {
  try {
    const mailOptions = {
      from: `"Reservas Apialan" <${process.env.EMAIL_USER}>`,
      to: reserva.cliente_email,
      subject: `❌ Notificación de Cancelación de Reserva (ID: ${reserva.id})`,
      html: await ejs.renderFile(
        path.join(__dirname, '../views/emails/cancelacionAdmin.ejs'),
        {
          reserva: reserva,
          formatCurrency: formatCurrency,
          formatDate: formatDate,
          formatTime: formatTime
        }
      ),
    };
    await transporter.sendMail(mailOptions);
    console.log(`Email de cancelación (iniciada por admin) enviado a ${reserva.cliente_email}`);
  } catch (error) {
    console.error(`Error al enviar email de cancelación (admin) para reserva ${reserva.id}:`, error);
  }
};


// Exportamos las cuatro funciones para poder usarlas en nuestras rutas
module.exports = {
  enviarEmailSolicitudRecibida,
  enviarEmailReservaConfirmada,
  enviarEmailCancelacionCliente,
  enviarEmailCancelacionAdmin,
};
