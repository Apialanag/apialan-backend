// Archivo: index.js de tu proyecto de backend

require('dotenv').config();
const pool = require('./db'); // Importar el pool de db.js
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DE CORS ---
// Tu configuración de whitelist está perfecta.
const whitelist = [
  'https://reservas-oficinas-apialan.vercel.app', // Frontend de clientes
  'http://localhost:5173',                         // Desarrollo local frontend de clientes
  // Añade aquí las URLs de tu panel de administración:
  'https://tu-panel-admin.vercel.app',             // EJEMPLO: URL de producción de tu panel de admin
  'http://localhost:5174'                          // EJEMPLO: URL de desarrollo local de tu panel de admin
];

const corsOptions = {
  origin: function (origin, callback) {
    // Log para depurar el valor de origin que llega al backend
    console.log('CORS check: Request origin:', origin);
    console.log('CORS whitelist:', whitelist);
    if (whitelist.includes(origin) || !origin) {
      console.log('CORS check: Origin PERMITIDO.');
      callback(null, true);
    } else {
      console.log('CORS check: Origin DENEGADO.');
      callback(new Error('No permitido por la política de CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json());


// =================================================================
//          ENDPOINT DE ESTADO (HEALTH CHECK) - CORREGIDO
// =================================================================

// Se cambia la ruta a /health-check para mantener consistencia.
app.get('/health-check', async (req, res) => {
  console.log('Health check endpoint fue invocado.');
  try {
    // Usamos el pool global directamente. Es más eficiente.
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', message: 'El servidor y la base de datos están activos.' });
  } catch (error) {
    console.error('Fallo en el health check:', error);
    res.status(503).json({ 
        status: 'error', 
        message: 'La conexión a la base de datos ha fallado.',
        error: error.message
    });
  }
});

// =================================================================
//          FIN DEL ENDPOINT DE ESTADO
// =================================================================


// ----- RUTAS DE LA APLICACIÓN (estas no cambian) -----
const espaciosRouter = require('./routes/espacios.routes.js');
const reservasRouter = require('./routes/reservas.routes.js');
const authRouter = require('./routes/auth.routes.js');
const adminRouter = require('./routes/admin.routes.js');
const sociosRouter = require('./routes/socios.routes.js');
const cuponesRouter = require('./routes/cupones.routes.js'); // Importar rutas de cupones
const blockedDatesRouter = require('./routes/blocked-dates.routes.js'); // Importar rutas de fechas bloqueadas

app.use('/espacios', espaciosRouter);
app.use('/reservas', reservasRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/socios', sociosRouter);
app.use('/cupones', cuponesRouter); // Usar rutas de cupones
app.use('/api/blocked-dates', blockedDatesRouter); // Usar rutas de fechas bloqueadas

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
