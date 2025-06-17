// scripts/crear-admin.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); // Load .env from project root
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL configuration might be needed if your local/dev DB requires it
  // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // For a CLI script, it's often simpler to assume direct connection or use a specific DB URL for admin tasks
});

pool.on('error', (err, client) => {
  console.error('Error inesperado en el cliente inactivo de la base de datos', err);
  process.exit(-1);
});

const promptUser = (query) => {
  return new Promise((resolve) => rl.question(query, resolve));
};

const promptPassword = (query) => {
  return new Promise((resolve) => {
    const listener = (char) => {
      char = char + '';
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl-D
          process.stdin.removeListener('data', listener);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          rl.output.write('\n');
          resolve(buffer);
          break;
        case '\u0003': // Ctrl-C
          process.stdin.removeListener('data', listener);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          rl.output.write('^C\n');
          process.exit();
          break;
        default:
          process.stdout.write('*'); // Mask password
          buffer += char;
          break;
      }
    };
    let buffer = '';
    rl.output.write(query);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', listener);
  });
};


const crearAdmin = async () => {
  try {
    const nombre = await promptUser('Nombre del administrador: ');
    const email = await promptUser('Email del administrador: ');
    const password = await promptPassword('Contraseña del administrador: '); // Using promptPassword for masking

    if (!nombre || !email || !password) {
      console.error('Todos los campos son obligatorios.');
      rl.close();
      pool.end();
      return;
    }

    // Verificar si el email ya existe
    const userExists = await pool.query('SELECT * FROM administradores WHERE email = $1', [email]);
    if (userExists.rowCount > 0) {
      console.error('El email ya está registrado.');
      rl.close();
      pool.end();
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const rol = 'admin'; // Explicitly set rol to 'admin'

    const nuevoAdminQuery = `
      INSERT INTO administradores (nombre, email, password_hash, rol)
      VALUES ($1, $2, $3, $4)
      RETURNING id, nombre, email, rol;
    `;
    const resultado = await pool.query(nuevoAdminQuery, [nombre, email, passwordHash, rol]);

    console.log('Administrador registrado exitosamente:');
    console.log(resultado.rows[0]);

  } catch (err) {
    console.error('Error al crear el administrador:', err.message);
    if (err.stack) {
        console.error(err.stack);
    }
  } finally {
    rl.close();
    await pool.end();
    console.log('Conexión a la base de datos cerrada.');
  }
};

crearAdmin();
