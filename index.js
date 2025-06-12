require('dotenv').config();
const express = require('express');
// Para esta prueba final, no usaremos la librería cors, sino cabeceras manuales.
// const cors = require('cors'); 

const app = express();
const PORT = process.env.PORT || 3000;

// --- INICIO DE LA CONFIGURACIÓN DE CORS MANUAL (PRUEBA DEFINITIVA) ---

// Este middleware intercepta todas las peticiones entrantes.
app.use((req, res, next) => {
  // Le damos permiso a CUALQUIER origen (*).
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Le decimos qué cabeceras están permitidas en la petición.
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  
  // Le decimos qué métodos HTTP están permitidos.
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, PATCH, OPTIONS'
  );
  
  // Si la petición es un OPTIONS (pre-vuelo de CORS), respondemos OK y terminamos.
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  // Si no, continuamos al siguiente middleware.
  next();
});

// --- FIN DE LA CONFIGURACIÓN ---


app.use(express.json());

// ----- RUTAS DE LA APLICACIÓN -----
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
