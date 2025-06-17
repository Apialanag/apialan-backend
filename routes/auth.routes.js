// routes/auth.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs'); // Para encriptar y comparar contraseñas
const jwt = require('jsonwebtoken'); // Para generar tokens
const checkAuth = require('../middleware/check-auth.js');
const checkIsAdmin = require('../middleware/check-is-admin.js');
const rateLimit = require('express-rate-limit');

// --- Endpoint para REGISTRAR un nuevo administrador ---
// POST /api/auth/register
// En una aplicación real, este endpoint estaría protegido o se usaría solo para la configuración inicial.
router.post('/register', checkAuth, checkIsAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;

    // Validación simple
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }

    // Verificar si el email ya existe
    const userExists = await pool.query('SELECT * FROM administradores WHERE email = $1', [email]);
    if (userExists.rowCount > 0) {
      return res.status(400).json({ error: 'El email ya está registrado.' });
    }

    // Encriptar (hashear) la contraseña
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const roleToAssign = rol || 'usuario'; // Default to 'usuario' if not provided by admin

    // Insertar el nuevo administrador en la base de datos
    const nuevoAdminQuery = `
      INSERT INTO administradores (nombre, email, password_hash, rol)
      VALUES ($1, $2, $3, $4)
      RETURNING id, nombre, email, rol, creado_en; -- Devolver el usuario sin el hash de la contraseña
    `;
    const resultado = await pool.query(nuevoAdminQuery, [nombre, email, passwordHash, roleToAssign]);
    
    res.status(201).json({
      mensaje: 'Administrador registrado exitosamente.',
      admin: resultado.rows[0]
    });

  } catch (err) {
    console.error("Error en el registro:", err.message);
    res.status(500).json({ error: 'Error del servidor al registrar el administrador.' });
  }
});


// --- Endpoint para INICIAR SESIÓN (LOGIN) de un administrador ---
// POST /api/auth/login

const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // Límite de 10 peticiones por IP por ventana de 1 minuto
  message: 'Demasiados intentos de login desde esta IP, por favor intente de nuevo después de un minuto.',
  standardHeaders: true, // Devuelve la información del límite en los headers `RateLimit-*`
  legacyHeaders: false, // Deshabilita los headers `X-RateLimit-*` (legacy)
  // keyGenerator: (req) => req.ip // Opcional: por defecto usa req.ip, pero se puede personalizar
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validación
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
    }

    // Buscar al administrador por su email
    const adminResult = await pool.query('SELECT * FROM administradores WHERE email = $1', [email]);
    if (adminResult.rowCount === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas.' }); // 401 Unauthorized
    }

    const admin = adminResult.rows[0];

    // Comparar la contraseña proporcionada con la contraseña encriptada en la BD
    const passwordValida = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales inválidas.' }); // Misma respuesta genérica por seguridad
    }

    // Si la contraseña es válida, crear un JSON Web Token (JWT)
    const payload = {
      id: admin.id,
      rol: admin.rol
    };
    
    const token = jwt.sign(
      payload, 
      process.env.JWT_SECRET, // Necesitaremos esta variable de entorno
      { expiresIn: '8h' } // El token expirará en 8 horas
    );

    res.status(200).json({
      mensaje: 'Login exitoso.',
      token: token
    });

  } catch (err) {
    console.error("Error en el login:", err.message);
    res.status(500).json({ error: 'Error del servidor al iniciar sesión.' });
  }
});


module.exports = router;
