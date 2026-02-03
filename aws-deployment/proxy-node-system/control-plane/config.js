require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'proxy_nodes'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-this-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },
  node: {
    heartbeatInterval: 30000, // 30 seconds
    healthCheckInterval: 60000, // 1 minute
    inactiveThreshold: 120000 // 2 minutes
  }
};
