// test/setup.js
const dotenv = require('dotenv');
const path = require('path');

// Cargar las variables de entorno desde .env.test
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
