const jwt = require('jsonwebtoken');
const config = require('../../config');

const authMiddleware = (req, res, next) => {
  // Skip auth for health checks and public endpoints
  if (req.path === '/health' || req.path.startsWith('/api/nodes/register') || req.path.startsWith('/api/nodes/') && req.path.includes('/heartbeat')) {
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

module.exports = authMiddleware;
