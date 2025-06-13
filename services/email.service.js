// Archivo: services/emailService.js

const nodemailer = require('nodemailer');

// Configuración del "Transportador" que enviará los emails usando Gmail.
// Toma las credenciales de tu archivo .env
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // La contraseña de aplicación de 16 letras de Google
  },
});


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
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2 style="color: #4f46e5;">¡Hola, ${reserva.cliente_nombre}!</h2>
          <p>Hemos recibido tu solicitud de reserva y hemos guardado tu cupo temporalmente. Para confirmar tu reserva de forma definitiva, por favor realiza el pago.</p>
          
          <h3 style="border-bottom: 2px solid #e0e7ff; padding-bottom: 5px; color: #3730a3;">Instrucciones de Pago</h3>
          <p>Puedes realizar una transferencia bancaria por un total de <strong>${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(reserva.costo_total)}</strong> a la siguiente cuenta:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr style="background-color: #f8f9fa;"><td style="padding: 10px; border: 1px solid #ddd;"><strong>Banco:</strong></td><td style="padding: 10px; border: 1px solid #ddd;">Banco Estado</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #ddd;"><strong>Tipo de Cuenta:</strong></td><td style="padding: 10px; border: 1px solid #ddd;">Corriente</td></tr>
            <tr style="background-color: #f8f9fa;"><td style="padding: 10px; border: 1px solid #ddd;"><strong>Número de Cuenta:</strong></td><td style="padding: 10px; border: 1px solid #ddd;">55100101199</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #ddd;"><strong>Nombre:</strong></td><td style="padding: 10px; border: 1px solid #ddd;">Asociación de prestadores de servicios, industriales y artesanos de Los Ángeles.</td></tr>
            <tr style="background-color: #f8f9fa;"><td style="padding: 10px; border: 1px solid #ddd;"><strong>RUT:</strong></td><td style="padding: 10px; border: 1px solid #ddd;">70.382.000-K</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 10px; border: 1px solid #ddd;">cie@apialan.cl</td></tr>
          </table>

          <p style="margin-top: 20px;">Una vez realizado el pago, por favor envía el comprobante a nuestro correo <strong>cie@apialan.cl</strong> para confirmar tu reserva. Tienes un plazo de 24 horas para realizar el pago, de lo contrario, la solicitud podría ser cancelada.</p>
          <hr>
          <h3>Detalles de tu Solicitud:</h3>
          <ul>
            <li><strong>ID de Reserva:</strong> ${reserva.id}</li>
            <li><strong>Salón:</strong> ${reserva.nombre_espacio}</li>
            <li><strong>Fecha:</strong> ${new Date(reserva.fecha_reserva).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
            <li><strong>Horario:</strong> ${reserva.hora_inicio.substring(0, 5)} - ${reserva.hora_termino.substring(0, 5)}</li>
          </ul>
          <p>Saludos,<br>El equipo de Apialan</p>
        </div>
      `,
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
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2>¡Hola, ${reserva.cliente_nombre}!</h2>
          <p>¡Tu reserva ha sido confirmada exitosamente! Hemos recibido tu pago y tu cupo está asegurado. ¡Te esperamos!</p>
          <hr>
          <h3>Detalles de tu Reserva:</h3>
          <ul>
            <li><strong>ID de Reserva:</strong> ${reserva.id}</li>
            <li><strong>Salón:</strong> ${reserva.nombre_espacio}</li>
            <li><strong>Fecha:</strong> ${new Date(reserva.fecha_reserva).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
            <li><strong>Horario:</strong> ${reserva.hora_inicio.substring(0, 5)} - ${reserva.hora_termino.substring(0, 5)}</li>
          </ul>
          <p>Si necesitas hacer cambios o tienes alguna consulta, no dudes en contactarnos.</p>
          <p>Saludos,<br>El equipo de Apialan</p>
        </div>
      `,
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
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2>¡Hola, ${reserva.cliente_nombre}!</h2>
          <p>Confirmamos que, <strong>según tu solicitud</strong>, hemos procesado la cancelación de tu reserva.</p>
          <hr>
          <h3>Detalles de la Reserva Cancelada:</h3>
          <ul>
            <li><strong>ID de Reserva:</strong> ${reserva.id}</li>
            <li><strong>Salón:</strong> ${reserva.nombre_espacio}</li>
            <li><strong>Fecha:</strong> ${new Date(reserva.fecha_reserva).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
          </ul>
          <p>El espacio ha sido liberado. Esperamos verte de nuevo pronto.</p>
          <p>Saludos,<br>El equipo de Apialan</p>
        </div>
      `,
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
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2>¡Hola, ${reserva.cliente_nombre}!</h2>
          <p>Te informamos que tu reserva ha sido cancelada por un administrador.</p>
          <hr>
          <h3>Detalles de la Reserva Cancelada:</h3>
          <ul>
            <li><strong>ID de Reserva:</strong> ${reserva.id}</li>
            <li><strong>Salón:</strong> ${reserva.nombre_espacio}</li>
            <li><strong>Fecha:</strong> ${new Date(reserva.fecha_reserva).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
          </ul>
          <p>Si tienes alguna duda sobre esta cancelación, por favor, ponte en contacto con nosotros.</p>
          <p>Saludos,<br>El equipo de Apialan</p>
        </div>
      `,
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
