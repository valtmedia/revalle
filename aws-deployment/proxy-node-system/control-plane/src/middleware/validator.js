const validator = {
  validateNodeRegistration: (req, res, next) => {
    const { host, port } = req.body;

    if (!host) {
      return res.status(400).json({
        success: false,
        error: 'Host is required'
      });
    }

    if (!port || port < 1 || port > 65535) {
      return res.status(400).json({
        success: false,
        error: 'Valid port (1-65535) is required'
      });
    }

    // Validate host format
    const hostRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^(\d{1,3}\.){3}\d{1,3}$/;
    if (!hostRegex.test(host)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid host format'
      });
    }

    next();
  },

  validateUserCreation: (req, res, next) => {
    const { username, password, email } = req.body;

    if (!username || username.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters'
      });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    next();
  },

  validatePagination: (req, res, next) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    if (page < 1) {
      return res.status(400).json({
        success: false,
        error: 'Page must be >= 1'
      });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: 'Limit must be between 1 and 100'
      });
    }

    req.pagination = { page, limit, offset: (page - 1) * limit };
    next();
  }
};

module.exports = validator;
