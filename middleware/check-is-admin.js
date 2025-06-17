// middleware/check-is-admin.js

module.exports = (req, res, next) => {
  // This middleware assumes a previous middleware (like check-auth.js)
  // has successfully authenticated the user and attached userData to the request.
  // req.userData should contain { id: userId, rol: userRole }

  if (!req.userData) {
    // This case should ideally be caught by check-auth.js,
    // but as a safeguard:
    return res.status(401).json({ error: 'Autenticación requerida. No hay datos de usuario.' });
  }

  if (req.userData.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador.' });
  }

  // If user is authenticated and has the 'admin' role, proceed to the next middleware/handler
  next();
};
