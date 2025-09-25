// Archivo: services/emailService.js

const sgMail = require('@sendgrid/mail');
const ejs = require('ejs');
const path = require('path');

// Configura SendGrid con la API Key de tus variables de entorno
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Define el email y nombre del remitente.
// ¡MUY IMPORTANTE! El email debe estar verificado en tu cuenta de SendGrid.
// Usa el email de tu dominio autenticado (apialan.cl).
const FROM_EMAIL = 'reservas@apialan.cl'; // O notificaciones@apialan.cl, etc.
const FROM_NAME = 'Reservas Apialan';

// --- Helper functions (sin cambios) ---
const formatCurrency = (amount) => {
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount)) return 'N/A';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(numAmount);
};
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      const parts = dateString.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10), month = parseInt(parts[1], 10) - 1, day = parseInt(parts[2], 10);
        const specificDate = new Date(year, month, day);
        if (!isNaN(specificDate.getTime())) return specificDate.toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
      }
      return 'Fecha inválida';
    }
    return date.toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) { return 'Fecha inválida'; }
};
const formatTime = (timeString) => {
  if (!timeString || typeof timeString !== 'string') return 'N/A';
  return timeString.substring(0, 5);
};

// --- FUNCIÓN GENERAL PARA ENVIAR CORREOS ---
// Refactorizamos para no repetir el bloque try/catch
const enviarEmail = async (msg) => {
  try {
    await sgMail.send(msg);
    console.log(`Email enviado a ${msg.to}`);
  } catch (error) {
    console.error(`Error al enviar email a ${msg.to}:`, error);
    if (error.response) {
      console.error(error.response.body);
    }
  }
};

// --- FUNCIÓN 1: EMAIL DE SOLICITUD DE RESERVA RECIBIDA ---
const enviarEmailSolicitudRecibida = async (reservaData) => {
  const msg = {
    to: reservaData.cliente_email,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `📄 Solicitud de Reserva Recibida (ID: ${reservaData.id})`,
    html: await ejs.renderFile(
      path.join(__dirname, '../views/emails/solicitudRecibida.ejs'),
      { reserva: reservaData, formatCurrency, formatDate, formatTime }
    ),
  };
  enviarEmail(msg);
};

// --- FUNCIÓN 2: EMAIL DE RESERVA CONFIRMADA ---
const enviarEmailReservaConfirmada = async (reserva) => {
  const msg = {
    to: reserva.cliente_email,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `✅ ¡Tu reserva en Apialan está Confirmada! (ID: ${reserva.id})`,
    html: await ejs.renderFile(
      path.join(__dirname, '../views/emails/reservaConfirmada.ejs'),
      { reserva, formatCurrency, formatDate, formatTime }
    ),
  };
  enviarEmail(msg);
};

// --- FUNCIÓN 3: EMAIL DE CANCELACIÓN SOLICITADA POR EL CLIENTE ---
const enviarEmailCancelacionCliente = async (reserva) => {
  const msg = {
    to: reserva.cliente_email,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `✅ Confirmación de Cancelación de Reserva (ID: ${reserva.id})`,
    html: await ejs.renderFile(
      path.join(__dirname, '../views/emails/cancelacionCliente.ejs'),
      { reserva, formatCurrency, formatDate, formatTime }
    ),
  };
  enviarEmail(msg);
};

// --- FUNCIÓN 4: EMAIL DE CANCELACIÓN INICIADA POR EL ADMINISTRADOR ---
const enviarEmailCancelacionAdmin = async (reserva) => {
  const msg = {
    to: reserva.cliente_email,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `❌ Notificación de Cancelación de Reserva (ID: ${reserva.id})`,
    html: await ejs.renderFile(
      path.join(__dirname, '../views/emails/cancelacionAdmin.ejs'),
      { reserva, formatCurrency, formatDate, formatTime }
    ),
  };
  enviarEmail(msg);
};

// --- FUNCIÓN 5: EMAIL DE NOTIFICACIÓN AL ADMINISTRADOR ---
const enviarEmailNotificacionAdminNuevaSolicitud = async (reservaData, adminEmail) => {
    // Asumiendo que tienes una plantilla llamada notificacionAdmin.ejs
    const htmlContent = await ejs.renderFile(
        path.join(__dirname, '../views/emails/notificacionAdmin.ejs'),
        { reservaData, formatCurrency, formatDate, formatTime }
      );

  const msg = {
    to: adminEmail,
    from: { email: FROM_EMAIL, name: 'Notificaciones Apialan' },
    subject: `Nueva Solicitud de Reserva Recibida - ID: ${reservaData.id}`,
    html: htmlContent,
  };
  enviarEmail(msg);
};

module.exports = {
  enviarEmailSolicitudRecibida,
  enviarEmailReservaConfirmada,
  enviarEmailCancelacionCliente,
  enviarEmailCancelacionAdmin,
  enviarEmailNotificacionAdminNuevaSolicitud,
};