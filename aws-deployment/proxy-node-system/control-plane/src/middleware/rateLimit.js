const RateLimiter = require('../rateLimiter');

const rateLimiter = new RateLimiter();

const rateLimitMiddleware = (limit = 100, window = 60) => {
  return async (req, res, next) => {
    const identifier = req.user?.userId || req.ip;
    const result = await rateLimiter.checkLimit(identifier, limit, window);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.reset);

    if (!result.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: result.reset
      });
    }

    next();
  };
};

const nodeRateLimit = async (req, res, next) => {
  const nodeId = req.params.id || req.body.nodeId;
  if (!nodeId) return next();

  const result = await rateLimiter.checkNodeLimit(nodeId, 1000, 60);
  
  if (!result.allowed) {
    return res.status(429).json({
      success: false,
      error: 'Node rate limit exceeded'
    });
  }

  next();
};

module.exports = {
  rateLimitMiddleware,
  nodeRateLimit
};
