// Archivo: index.js de tu proyecto de backend (con Health Check)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // <-- Importante: Añadido para la conexión a la BD

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DE LA CONEXIÓN A LA BASE DE DATOS ---
// Se crea una única instancia de Pool para ser usada en toda la app.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Render provee esta variable
  // Descomenta las siguientes líneas si necesitas SSL para conexiones locales a Render
  // ssl: {
  //   rejectUnauthorized: false
  // }
});


// --- CONFIGURACIÓN DE CORS ---
const whitelist = [
  'https://reservas-oficinas-apialan.vercel.app',
  'http://localhost:5173'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (whitelist.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por la política de CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json());


// =================================================================
//                 NUEVO ENDPOINT DE ESTADO (HEALTH CHECK)
// =================================================================
app.get('/api/health', async (req, res) => {
  console.log('Health check endpoint fue invocado.'); // Log para depuración
  try {
    // Intenta hacer una consulta simple para verificar la conexión a la BD
    const client = await pool.connect();
    await client.query('SELECT 1'); // Despierta la conexión si está inactiva
    client.release();
    
    // Si la consulta fue exitosa, responde con estado OK
    res.status(200).json({ 
        status: 'ok', 
        message: 'El servidor y la conexión a la base de datos funcionan correctamente.' 
    });
  } catch (error) {
    // Si hay un error, informa del problema
    console.error('Fallo en el health check:', error);
    res.status(503).json({ 
        status: 'error', 
        message: 'La conexión a la base de datos ha fallado.',
        error: error.message
    });
  }
});
// =================================================================
//                 FIN DEL ENDPOINT DE ESTADO
// =================================================================


// ----- RUTAS DE LA APLICACIÓN (estas no cambian) -----
const espaciosRouter = require('./routes/espacios.routes.js');
const reservasRouter = require('./routes/reservas.routes.js');
const authRouter = require('./routes/auth.routes.js');
const adminRouter = require('./routes/admin.routes.js');

app.use('/espacios', espaciosRouter);
app.use('/reservas', reservasRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);

// Ruta de bienvenida
app.get('/', (req, res) => {
  res.send('¡Hola! El backend de APIALAN AG está funcionando.');
});

// Ruta de prueba de BD (ahora usa el pool global)
app.get('/testdb', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: `Conexión a BD exitosa`, time: result.rows[0].now });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error conectando a la BD');
  }
});

// --- INICIO DEL SERVIDOR (siempre al final) ---
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
