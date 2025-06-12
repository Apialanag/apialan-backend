require('dotenv').config();
const express = 'express';
const cors = 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// --- INICIO DE LA NUEVA CONFIGURACIÓN DE CORS ---

// 1. Define la lista de orígenes permitidos.
const whitelist = [
    'http://localhost:5173',
    'https://reservas-oficinas-apialan.vercel.app'
];

// 2. Crea una configuración de CORS que usa la lista blanca.
//    Esta configuración es más directa y estándar.
const corsOptions = {
    origin: whitelist,
    optionsSuccessStatus: 200
};

// 3. Usa la nueva configuración.
app.use(cors(corsOptions));

// --- FIN DE LA NUEVA CONFIGURACIÓN ---

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
