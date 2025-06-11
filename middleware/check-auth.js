// middleware/check-auth.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    // Los tokens se suelen enviar en un encabezado (header) llamado 'Authorization'.
    // El formato común es: "Bearer TOKEN_AQUI"
    const token = req.headers.authorization.split(" ")[1]; // Extraemos el token después de "Bearer "

    if (!token) {
        return res.status(401).json({ error: 'Autenticación fallida: no se proporcionó token.' });
    }
    
    // Verificar el token con la misma clave secreta
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    
    // Opcional: Podemos añadir los datos decodificados del token a la petición
    // para que las rutas posteriores puedan saber qué usuario está haciendo la solicitud.
    req.userData = { id: decodedToken.id, rol: decodedToken.rol };
    
    // Si el token es válido, llamamos a next() para que la petición continúe
    // hacia la ruta final (ej: router.delete(...))
    next();

  } catch (error) {
    // Si req.headers.authorization no existe, o el token no es válido,
    // jwt.verify lanzará un error que capturamos aquí.
    return res.status(401).json({ error: 'Autenticación fallida.' });
  }
};
