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
  // Asegurarse de que amount sea un número antes de formatear
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount)) {
    return 'N/A'; // O algún valor predeterminado o manejo de error
  }
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(numAmount);
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  // Convertir a objeto Date solo si no lo es ya, y manejar fechas inválidas
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) { // Verifica si la fecha es inválida
        // Intenta parsear específicamente YYYY-MM-DD si la conversión directa falla
        const parts = dateString.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) -1; // Meses son 0-indexados
            const day = parseInt(parts[2], 10);
            const specificDate = new Date(year, month, day);
            if (!isNaN(specificDate.getTime())) {
                 return specificDate.toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
            }
        }
        return 'Fecha inválida';
    }
    return date.toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) {
    return 'Fecha inválida';
  }
};

const formatTime = (timeString) => {
  if (!timeString || typeof timeString !== 'string') return 'N/A';
  return timeString.substring(0, 5);
};

// --- FUNCIÓN 1: EMAIL DE SOLICITUD DE RESERVA RECIBIDA (ACTUALIZADA) ---
/**
 * Envía un email inicial al cliente informando que su solicitud ha sido recibida
 * y está pendiente de pago.
 * @param {object} reservaData - El objeto con los datos para el email.
 */
const enviarEmailSolicitudRecibida = async (reservaData) => {
  try {
    const mailOptions = {
      from: `"Reservas Apialan" <${process.env.EMAIL_USER}>`,
      to: reservaData.cliente_email,
      subject: `📄 Solicitud de Reserva Recibida (ID: ${reservaData.id})`,
      html: await ejs.renderFile(
        path.join(__dirname, '../views/emails/solicitudRecibida.ejs'),
        {
          reserva: reservaData, // Este objeto ahora contiene los campos como costo_total_solicitud, etc.
          formatCurrency: formatCurrency,
          formatDate: formatDate,
          formatTime: formatTime
        }
      ),
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email de solicitud recibida enviado a ${reservaData.cliente_email}`);
  } catch (error) {
    console.error(`Error al enviar email de solicitud para reserva ${reservaData.id}:`, error);
  }
};


// --- FUNCIÓN 2: EMAIL DE RESERVA CONFIRMADA (TRAS EL PAGO) ---
const enviarEmailReservaConfirmada = async (reserva) => {
  try {
    // Para el email de confirmación, si es una reserva de rango, reserva.costo_total_historico es el total.
    // Si es una reserva discreta individual, es el costo de ese día.
    // La plantilla reservaConfirmada.ejs fue adaptada para mostrar el costo total de la solicitud si se le pasa,
    // o el costo_total_historico de la reserva individual.
    // Aquí, `reserva` es una fila de la BD. Si queremos mostrar el total de la solicitud original
    // para una reserva discreta, necesitaríamos más contexto o pasar un objeto `datosParaEmail` similar.
    // Por ahora, la plantilla usará `reserva.costo_total_historico` si `costo_total_solicitud` no está.
    const datosParaPlantillaConfirmacion = {
        ...reserva,
        // Si es una reserva de rango, costo_total_historico es el total.
        // Si es un día único, costo_total_historico es el total.
        // Si es una de varias discretas, costo_total_historico es individual.
        // La plantilla debe ser lo suficientemente inteligente o se le debe pasar explícitamente `costo_total_solicitud`.
        // Como esta función recibe una reserva individual, `costo_total_solicitud` no está naturalmente aquí.
        // La plantilla `reservaConfirmada.ejs` fue modificada para usar `reserva.costo_total_solicitud || reserva.costo_total_historico`
    };

    const mailOptions = {
      from: `"Reservas Apialan" <${process.env.EMAIL_USER}>`,
      to: reserva.cliente_email,
      subject: `✅ ¡Tu reserva en Apialan está Confirmada! (ID: ${reserva.id})`,
      html: await ejs.renderFile(
        path.join(__dirname, '../views/emails/reservaConfirmada.ejs'),
        {
          reserva: datosParaPlantillaConfirmacion,
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


// --- FUNCIÓN 5: EMAIL DE NOTIFICACIÓN AL ADMINISTRADOR SOBRE NUEVA SOLICITUD ---
/**
 * Envía un email de notificación al administrador sobre una nueva solicitud de reserva.
 * @param {object} reservaData - El objeto con todos los datos de la solicitud para el email.
 * @param {string} adminEmail - La dirección de correo del administrador.
 */
const enviarEmailNotificacionAdminNuevaSolicitud = async (reservaData, adminEmail) => {
  try {
    const detallesReserva = `
      <p>Se ha recibido una nueva solicitud de reserva con los siguientes detalles:</p>
      <ul>
        <li><strong>ID Reserva Principal:</strong> ${reservaData.id}</li>
        <li><strong>Espacio:</strong> ${reservaData.nombre_espacio || 'No especificado'}</li>
        <li><strong>Cliente:</strong> ${reservaData.cliente_nombre}</li>
        <li><strong>Email Cliente:</strong> ${reservaData.cliente_email}</li>
        <li><strong>Teléfono Cliente:</strong> ${reservaData.cliente_telefono || 'No especificado'}</li>
        ${ reservaData.dias_discretos_info && reservaData.dias_discretos_info.length > 0 ?
          `<li><strong>Fechas (Días Discretos):</strong><ul>${reservaData.dias_discretos_info.map(d => `<li>${formatDate(d)}</li>`).join('')}</ul></li>` :
        reservaData.end_date && reservaData.end_date !== reservaData.fecha_reserva ? // Asegurar que end_date sea diferente de fecha_reserva para considerarlo rango
          `<li><strong>Fechas del Rango:</strong> Desde ${formatDate(reservaData.fecha_reserva)} hasta ${formatDate(reservaData.end_date)}</li>` :
          `<li><strong>Fecha:</strong> ${formatDate(reservaData.fecha_reserva)}</li>`
        }
        <li><strong>Hora Inicio:</strong> ${formatTime(reservaData.hora_inicio)}</li>
        <li><strong>Hora Término:</strong> ${formatTime(reservaData.hora_termino)}</li>
      </ul>
      <hr>
      <h3>Detalles del Costo de la Solicitud:</h3>
      <ul>
        <li><strong>Subtotal Neto Solicitud:</strong> ${formatCurrency(reservaData.costo_neto_total_solicitud_o_equivalente)}</li>
        ${(reservaData.monto_descuento_total_solicitud_o_equivalente && parseFloat(reservaData.monto_descuento_total_solicitud_o_equivalente) > 0) ? `
          <li><strong>Descuento Cupón Total:</strong> - ${formatCurrency(reservaData.monto_descuento_total_solicitud_o_equivalente)}</li>
          <li><strong>Neto con Descuento:</strong> ${formatCurrency(parseFloat(reservaData.costo_neto_total_solicitud_o_equivalente) - parseFloat(reservaData.monto_descuento_total_solicitud_o_equivalente))}</li>
        ` : ''}
        <li><strong>IVA (19%) Solicitud:</strong> ${formatCurrency(reservaData.iva_total_solicitud_o_equivalente)}</li>
        <li><strong>Total General Solicitud:</strong> ${formatCurrency(reservaData.costo_total_solicitud)}</li>
      </ul>
       ${ reservaData.notas_adicionales ? `
      <hr>
      <h3>Notas Adicionales:</h3>
      <p>${reservaData.notas_adicionales}</p>
      ` : '' }
      ${ reservaData.socio_id ? `
      <hr>
      <p><strong>Reserva de Socio ID:</strong> ${reservaData.socio_id}</p>
      ` : ''}
      ${ reservaData.tipo_documento ? `
      <hr>
      <h3>Información de Facturación:</h3>
      <ul>
        <li><strong>Tipo Documento:</strong> ${reservaData.tipo_documento}</li>
        ${ reservaData.tipo_documento === 'factura' ? `
        <li><strong>RUT Facturación:</strong> ${reservaData.facturacion_rut || 'No especificado'}</li>
        <li><strong>Razón Social:</strong> ${reservaData.facturacion_razon_social || 'No especificado'}</li>
        <li><strong>Dirección Facturación:</strong> ${reservaData.facturacion_direccion || 'No especificado'}</li>
        <li><strong>Giro:</strong> ${reservaData.facturacion_giro || 'No especificado'}</li>
        ` : '' }
      </ul>
      ` : '' }
      <p>Por favor, revisa el panel de administración para más detalles o para confirmar la reserva una vez recibido el pago.</p>
    `;

    const mailOptions = {
      from: `"Notificaciones Apialan" <${process.env.EMAIL_USER}>`,
      to: adminEmail,
      subject: `Nueva Solicitud de Reserva Recibida - ID: ${reservaData.id}`,
      html: detallesReserva,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email de notificación de nueva solicitud enviado a ${adminEmail} para reserva ID: ${reservaData.id}`);
  } catch (error) {
    console.error(`Error al enviar email de notificación al admin para reserva ${reservaData.id}:`, error);
  }
};

module.exports = {
  enviarEmailSolicitudRecibida,
  enviarEmailReservaConfirmada,
  enviarEmailCancelacionCliente,
  enviarEmailCancelacionAdmin,
  enviarEmailNotificacionAdminNuevaSolicitud,
};
