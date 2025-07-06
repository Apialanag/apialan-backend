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
  // enviarEmailNotificacionAdminNuevaSolicitud, // Se moverá al final
};

// --- FUNCIÓN 5: EMAIL DE NOTIFICACIÓN AL ADMINISTRADOR SOBRE NUEVA SOLICITUD ---
/**
 * Envía un email de notificación al administrador sobre una nueva solicitud de reserva.
 * @param {object} reserva - El objeto de la reserva creada.
 * @param {string} adminEmail - La dirección de correo del administrador.
 */
const enviarEmailNotificacionAdminNuevaSolicitud = async (reserva, adminEmail) => {
  try {
    // Podríamos crear una plantilla EJS específica para este correo si el formato es complejo,
    // o construir un HTML simple directamente aquí. Por simplicidad, usaremos un texto/html básico.
    const detallesReserva = `
      <p>Se ha recibido una nueva solicitud de reserva con los siguientes detalles:</p>
      <ul>
        <li><strong>ID Reserva:</strong> ${reserva.id}</li>
        <li><strong>Espacio:</strong> ${reserva.nombre_espacio || 'No especificado'}</li>
        <li><strong>Cliente:</strong> ${reserva.cliente_nombre}</li>
        <li><strong>Email Cliente:</strong> ${reserva.cliente_email}</li>
        <li><strong>Teléfono Cliente:</strong> ${reserva.cliente_telefono || 'No especificado'}</li>
        <li><strong>Fecha:</strong> ${formatDate(reserva.fecha_reserva)}</li>
        <li><strong>Hora Inicio:</strong> ${formatTime(reserva.hora_inicio)}</li>
        <li><strong>Hora Término:</strong> ${formatTime(reserva.hora_termino)}</li>
      </ul>
      <hr>
      <h3>Detalles del Costo:</h3>
      <ul>
        <li><strong>Subtotal Neto:</strong> ${formatCurrency(reserva.costo_neto_historico)}</li>
        ${(reserva.monto_descuento_aplicado && parseFloat(reserva.monto_descuento_aplicado) > 0) ? `
          <li><strong>Descuento Cupón:</strong> - ${formatCurrency(reserva.monto_descuento_aplicado)}</li>
          <li><strong>Neto con Descuento:</strong> ${formatCurrency(parseFloat(reserva.costo_neto_historico) - parseFloat(reserva.monto_descuento_aplicado))}</li>
        ` : ''}
        <li><strong>IVA (19%):</strong> ${formatCurrency(reserva.costo_iva_historico)}</li>
        <li><strong>Total General:</strong> ${formatCurrency(reserva.costo_total_historico)}</li>
      </ul>
       ${ reserva.notas_adicionales ? `
      <hr>
      <h3>Notas Adicionales:</h3>
      <p>${reserva.notas_adicionales}</p>
      ` : '' }
      ${ reserva.socio_id ? `
      <hr>
      <p><strong>Reserva de Socio ID:</strong> ${reserva.socio_id}</p>
      ` : ''}
      ${ reserva.tipo_documento ? `
      <hr>
      <h3>Información de Facturación:</h3>
      <ul>
        <li><strong>Tipo Documento:</strong> ${reserva.tipo_documento}</li>
        ${ reserva.tipo_documento === 'factura' ? `
        <li><strong>RUT Facturación:</strong> ${reserva.facturacion_rut || 'No especificado'}</li>
        <li><strong>Razón Social:</strong> ${reserva.facturacion_razon_social || 'No especificado'}</li>
        <li><strong>Dirección Facturación:</strong> ${reserva.facturacion_direccion || 'No especificado'}</li>
        <li><strong>Giro:</strong> ${reserva.facturacion_giro || 'No especificado'}</li>
        ` : '' }
      </ul>
      ` : '' }
      <p>Por favor, revisa el panel de administración para más detalles o para confirmar la reserva una vez recibido el pago.</p>
    `;

    const mailOptions = {
      from: `"Notificaciones Apialan" <${process.env.EMAIL_USER}>`,
      to: adminEmail, // Enviar al correo del administrador
      subject: `Nueva Solicitud de Reserva Recibida - ID: ${reserva.id}`, // Emoji eliminado por si causa problemas
      html: detallesReserva,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email de notificación de nueva solicitud enviado a ${adminEmail} para reserva ID: ${reserva.id}`);
  } catch (error) {
    console.error(`Error al enviar email de notificación al admin para reserva ${reserva.id}:`, error);
    // Considerar no lanzar el error para no afectar el flujo principal si solo falla el correo al admin
  }
};

// Mover el bloque module.exports al final del archivo
module.exports = {
  enviarEmailSolicitudRecibida,
  enviarEmailReservaConfirmada,
  enviarEmailCancelacionCliente,
  enviarEmailCancelacionAdmin,
  enviarEmailNotificacionAdminNuevaSolicitud,
};
