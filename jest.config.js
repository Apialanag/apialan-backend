/** @type {import('jest').Config} */
const config = {
  // El entorno en el que se ejecutarán las pruebas
  testEnvironment: 'node',

  // Limpiar mocks automáticamente entre cada prueba
  clearMocks: true,

  // Patrones de archivos que Jest debe usar para detectar archivos de prueba
  testMatch: [
    '**/test/**/*.test.js',
    '**/__tests__/**/*.test.js',
  ],

  // Un setup que se ejecuta una vez antes de todas las suites de pruebas
  // Ideal para cargar variables de entorno de prueba
  setupFilesAfterEnv: ['./test/setup.js'],

  // Verbose output
  verbose: true,
};

module.exports = config;
