// db.js
require('dotenv').config(); // Idealmente, esta es la primera línea

// Línea para la prueba de depuración de la contraseña (¡RECUERDA BORRARLA DESPUÉS!)
// console.log("Contraseña que se usará para la BD:", process.env.DB_PASSWORD);

const { Pool } = require('pg'); // <-- ESTA LÍNEA DEBE ESTAR SOLO UNA VEZ

const pool = new Pool({ // Aquí se usa 'pool' en minúscula, que es diferente de 'Pool'
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432"),
});

pool.connect((err, client, release) => {
  if (err) {
    // Si todavía tienes la línea de depuración de la contraseña arriba,
    // este error podría aparecer DESPUÉS de ese console.log.
    return console.error('Error adquiriendo cliente para la BD:', err.stack);
  }
  client.query('SELECT NOW()', (err, result) => {
    release();
    if (err) {
      return console.error('Error ejecutando query de prueba:', err.stack);
    }
    console.log(`Conexión exitosa a la base de datos ${process.env.DB_DATABASE}: ${result.rows[0].now}`);
  });
});

module.exports = pool; // Exportas 'pool' en minúscula