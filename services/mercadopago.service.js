// services/mercadopago.service.js
require('dotenv').config();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// Lee el Access Token desde las variables de entorno
const accessToken = process.env.MP_ACCESS_TOKEN;

// Valida que el Access Token esté configurado
if (!accessToken) {
  console.error("Error: El Access Token de Mercado Pago (MP_ACCESS_TOKEN) no está configurado en el archivo .env");
}

// Crea el cliente de configuración de Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: accessToken,
  options: {
    timeout: 5000,
  }
});

// Crea una instancia de los servicios que vamos a usar
const preference = new Preference(client);
const payment = new Payment(client);

// Exporta las instancias para que puedan ser utilizadas en otras partes de la aplicación
module.exports = {
  preference,
  payment
};
