// src/db.js
require('dotenv').config();
const { Pool } = require('pg');

// 1. Verificamos si estamos en el entorno de producción (en Render)
const isProduction = process.env.NODE_ENV === 'production';

// 2. Definimos la cadena de conexión basada en el entorno
const connectionString = isProduction 
  ? process.env.DATABASE_URL // Usa la URL de la base de datos de Render
  : `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`; // Usa tus variables locales

// Depuración: Nos dirá en los logs qué entorno está usando
console.log(`--- INICIANDO CONEXIÓN A LA BASE DE DATOS ---`);
console.log(`Modo Producción: ${isProduction}`);

// 3. Creamos el pool de conexiones con la configuración correcta
const pool = new Pool({
  connectionString: connectionString,
  // En producción, Render requiere una conexión SSL.
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

// Añadimos un listener para errores de conexión
pool.on('error', (err, client) => {
  console.error('Error inesperado en el cliente inactivo de la base de datos', err);
  process.exit(-1);
});

// Probamos la conexión al iniciar la aplicación
pool.query('SELECT NOW()', (err, result) => {
    if (err) {
      return console.error('Error al ejecutar la query de prueba de conexión:', err.stack);
    }
    console.log(`Conexión exitosa a la base de datos: ${result.rows[0].now}`);
});

module.exports = pool;
