require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- INICIO DE LA MODIFICACIÓN DE CORS (CON DEPURACIÓN) ---

// 1. Define la lista de orígenes (URLs) que tienen permiso para hablar con tu API.
const whitelist = [
    'http://localhost:5173', // Para tu desarrollo local
    'https://reservas-oficinas-apialan.vercel.app' // ¡IMPORTANTE! Tu URL de Vercel
];

const corsOptions = {
  origin: function (origin, callback) {
    // --- LÍNEA DE DEPURACIÓN AÑADIDA ---
    // Esto imprimirá en los logs de Render la URL de origen de CADA petición que llegue.
    console.log('PETICIÓN RECIBIDA CON ORIGEN: ', origin); 
    // ------------------------------------

    // La lógica permite peticiones de la whitelist y peticiones sin origen (como las de Postman)
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      // Si el origen no está en la lista, lo rechaza.
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  optionsSuccessStatus: 200
};

// 2. Usa la configuración de CORS específica.
app.use(cors(corsOptions));

// --- FIN DE LA MODIFICACIÓN ---

app.use(express.json());

// ----- RUTAS DE LA APLICACIÓN -----
const espaciosRouter = require('./routes/espacios.routes.js');
const reservasRouter = require('./routes/reservas.routes.js');
const authRouter = require('./routes/auth.routes.js');
const adminRouter = require('./routes/admin.routes.js');

app.use('/api/espacios', espaciosRouter);
app.use('/api/reservas', reservasRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);

// Ruta de bienvenida
app.get('/', (req, res) => {
  res.send('¡Hola! El backend de APIALAN AG está funcionando.');
});

// Ruta de prueba de BD (opcional)
app.get('/testdb', async (req, res) => {
  try {
    const pool = require('./db.js');
    const result = await pool.query('SELECT NOW()');
    res.json({ message: `Conexión a BD exitosa`, time: result.rows[0].now });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error conectando a la BD');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
