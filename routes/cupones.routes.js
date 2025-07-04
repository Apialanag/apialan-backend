// Archivo: routes/cupones.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../db'); // Acceso a la base de datos
const { format } = require('date-fns'); // Para manejar fechas, si es necesario

// Endpoint: POST /cupones/validar
// Valida un código de cupón y calcula el descuento aplicable.
router.post('/validar', async (req, res) => {
  const { codigo_cupon, monto_neto_base_reserva } = req.body;

  if (!codigo_cupon || monto_neto_base_reserva === undefined) {
    return res.status(400).json({
      esValido: false,
      mensaje: 'El código de cupón y el monto neto base de la reserva son requeridos.',
    });
  }

  if (typeof monto_neto_base_reserva !== 'number' || monto_neto_base_reserva < 0) {
    return res.status(400).json({
      esValido: false,
      mensaje: 'El monto neto base de la reserva debe ser un número positivo.',
    });
  }

  try {
    const cuponResult = await pool.query('SELECT * FROM cupones WHERE codigo = $1', [codigo_cupon]);

    if (cuponResult.rows.length === 0) {
      return res.status(404).json({ esValido: false, mensaje: 'Cupón no encontrado.' });
    }

    const cupon = cuponResult.rows[0];

    // 1. Validar si el cupón está activo
    if (!cupon.activo) {
      return res.status(400).json({ esValido: false, mensaje: 'Este cupón ya no está activo.' });
    }

    // 2. Validar fechas de validez
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0); // Comparar solo fechas, ignorando la hora

    if (cupon.fecha_validez_desde) {
      const fechaDesde = new Date(cupon.fecha_validez_desde);
      if (hoy < fechaDesde) {
        return res.status(400).json({ esValido: false, mensaje: `Este cupón es válido a partir del ${format(fechaDesde, 'dd/MM/yyyy')}.` });
      }
    }
    if (cupon.fecha_validez_hasta) {
      const fechaHasta = new Date(cupon.fecha_validez_hasta);
      if (hoy > fechaHasta) {
        return res.status(400).json({ esValido: false, mensaje: 'Este cupón ha expirado.' });
      }
    }

    // 3. Validar usos máximos
    if (cupon.usos_maximos !== null && cupon.usos_actuales >= cupon.usos_maximos) {
      return res.status(400).json({ esValido: false, mensaje: 'Este cupón ha alcanzado su límite de usos.' });
    }

    // 4. Validar monto mínimo de reserva neto
    if (monto_neto_base_reserva < parseFloat(cupon.monto_minimo_reserva_neto)) {
      return res.status(400).json({
        esValido: false,
        mensaje: `Este cupón requiere un monto mínimo de reserva de ${parseFloat(cupon.monto_minimo_reserva_neto).toLocaleString('es-CL', {style: 'currency', currency: 'CLP'})} (neto).`
      });
    }

    // Si todas las validaciones pasan, calcular el descuento
    let montoDescontado = 0;
    let netoConDescuento = monto_neto_base_reserva;

    if (cupon.tipo_descuento === 'porcentaje') {
      montoDescontado = (monto_neto_base_reserva * parseFloat(cupon.valor_descuento)) / 100;
    } else if (cupon.tipo_descuento === 'fijo') {
      montoDescontado = parseFloat(cupon.valor_descuento);
    }

    // Asegurarse de que el descuento no sea mayor que el monto base
    montoDescontado = Math.min(montoDescontado, monto_neto_base_reserva);

    netoConDescuento = monto_neto_base_reserva - montoDescontado;

    // Redondear a 2 decimales por si acaso, aunque NUMERIC debería manejarlo bien.
    montoDescontado = parseFloat(montoDescontado.toFixed(2));
    netoConDescuento = parseFloat(netoConDescuento.toFixed(2));

    let mensajeExito = `Cupón '${cupon.codigo}' aplicado. `;
    if (cupon.tipo_descuento === 'porcentaje') {
        mensajeExito += `${parseFloat(cupon.valor_descuento)}% de descuento.`;
    } else {
        mensajeExito += `${montoDescontado.toLocaleString('es-CL', {style: 'currency', currency: 'CLP'})} de descuento.`;
    }


    return res.status(200).json({
      esValido: true,
      mensaje: mensajeExito,
      codigoCuponValidado: cupon.codigo,
      montoDescontado: montoDescontado,
      netoConDescuento: netoConDescuento,
      // Podríamos devolver también el ID del cupón para facilitar su uso en el siguiente paso de reserva
      cuponId: cupon.id
    });

  } catch (error) {
    console.error('Error al validar el cupón:', error);
    res.status(500).json({ esValido: false, mensaje: 'Error interno del servidor al validar el cupón.' });
  }
});

module.exports = router;
