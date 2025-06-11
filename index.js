require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // <--- 2. Usar el middleware cors. Esto permitirá todas las peticiones cross-origin.
app.use(express.json()); // Middleware para que Express entienda peticiones JSON

// ----- SECCIÓN IMPORTANTE PARA LA RUTA DE ESPACIOS -----
// 1. Importar el router de espacios:
const espaciosRouter = require('./routes/espacios.routes.js');
const reservasRouter = require('./routes/reservas.routes.js');
const authRouter = require('./routes/auth.routes.js');
const adminRouter = require('./routes/admin.routes.js');
// 2. Usar el router de espacios para la URL base /api/espacios:
app.use('/api/espacios', espaciosRouter);
app.use('/api/reservas', reservasRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
// ---------------------------------------------------------

// Tu ruta de bienvenida (debería estar)
app.get('/', (req, res) => {
  res.send('¡Hola! El backend de APIALAN AG está funcionando.');
});

// Ruta de prueba de BD (es opcional, puedes mantenerla o quitarla)
// Si la mantienes, asegúrate de que `pool` esté definido si lo usas aquí.
// const pool = require('./db.js'); // Necesitarías esta línea si usas `pool` en /testdb
app.get('/testdb', async (req, res) => {
  // Para que esta ruta funcione sin errores si la mantienes,
  // necesitarías importar `pool` aquí como en la línea comentada arriba.
  // O puedes quitar esta ruta /testdb si ya no la necesitas.
  try {
    const pool_test = require('./db.js'); // Importa pool aquí para esta ruta específica
    const result = await pool_test.query('SELECT NOW()');
    res.json({ message: `Conexión a BD ${process.env.DB_DATABASE} exitosa`, time: result.rows[0].now });
  } catch (err) {
    console.error(err.message); // Cambiado para mostrar el mensaje de error
    res.status(500).send('Error conectando a la BD');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  // El mensaje de conexión a la BD (de db.js) debería aparecer cuando el servidor inicia
  console.log(`Prueba tu API de espacios en: http://localhost:${PORT}/api/espacios`);
  console.log(`API de reservas (POST para crear) en: http://localhost:${PORT}/api/reservas`);
});