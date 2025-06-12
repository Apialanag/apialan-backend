// Archivo: index.js de tu proyecto de backend

require('dotenv').config();
const express = require('express');
const cors = require('cors'); // <-- 1. Asegúrate de que cors esté importado

const app = express();
const PORT = process.env.PORT || 3000;

// --- INICIO DE LA CONFIGURACIÓN DE CORS (CORREGIDA) ---

// 2. Define la lista de orígenes permitidos (tu frontend en Vercel y tu entorno local).
const whitelist = [
  'https://reservas-oficinas-apialan.vercel.app',
  'http://localhost:5173' // Puerto por defecto de Vite para desarrollo local
];

const corsOptions = {
  origin: function (origin, callback) {
    // Permite peticiones si el origen está en la lista blanca o si no tienen origen (como Postman/Insomnia)
    if (whitelist.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por la política de CORS'));
    }
  }
};

// 3. Usa el middleware de cors con tus opciones.
// Esto manejará automáticamente las peticiones GET, POST y las de pre-vuelo (OPTIONS).
app.use(cors(corsOptions));

// --- FIN DE LA CONFIGURACIÓN ---


app.use(express.json());

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
