// services/mercadopago.service.js
require('dotenv').config();
const { MercadoPagoConfig, Payment } = require('mercadopago');

// Lee el Access Token desde las variables de entorno
const accessToken = process.env.MP_ACCESS_TOKEN;

// Valida que el Access Token esté configurado
if (!accessToken) {
  console.error("Error: El Access Token de Mercado Pago (MP_ACCESS_TOKEN) no está configurado en el archivo .env");
  // En un entorno de producción, podrías querer que la aplicación no se inicie si falta esta configuración.
  // process.exit(1);
}

// Crea el cliente de configuración de Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: accessToken,
  options: {
    timeout: 5000, // Tiempo de espera para las peticiones en milisegundos
  }
});

// Crea una instancia del servicio de Pagos que se usará para crear preferencias, etc.
const payment = new Payment(client);

// Exporta el cliente y el servicio de pagos para que puedan ser utilizados en otras partes de la aplicación
module.exports = {
  client,
  payment
};
