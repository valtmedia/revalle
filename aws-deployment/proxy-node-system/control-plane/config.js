'use strict';

/**
 * Centralized Configuration
 * Loads from environment variables with sensible defaults
 */

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS || '*',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 500,

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || null
  },

  // Database
  database: {
    host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || process.env.DB_PORT) || 3306,
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'proxy_system',
    connectionLimit: parseInt(process.env.DB_POOL_SIZE) || 10
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'change-this-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },

  // Node management
  node: {
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000,
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 60000,
    inactiveThreshold: parseInt(process.env.INACTIVE_THRESHOLD) || 120000,
    maxNodesPerRegion: parseInt(process.env.MAX_NODES_PER_REGION) || 50
  },

  // Admin
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14d'
  },

  // Backup
  backup: {
    dir: process.env.BACKUP_DIR || './backups',
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
    autoBackup: process.env.AUTO_BACKUP !== 'false'
  },

  // Data directory (for embedded database)
  data: {
    dir: process.env.DATA_DIR || './data'
  },

  // SSL
  ssl: {
    certsDir: process.env.CERTS_DIR || './certs',
    caCommonName: process.env.CA_COMMON_NAME || 'ProxyNodeSystem CA'
  },

  // Proxy defaults
  proxy: {
    defaultPort: parseInt(process.env.DEFAULT_PROXY_PORT) || 3128,
    maxConnectionsPerNode: parseInt(process.env.MAX_CONNECTIONS_PER_NODE) || 1000,
    connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT) || 60
  },

  // Security
  security: {
    maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 300,
    autoBlockOnAbuse: process.env.AUTO_BLOCK_ON_ABUSE !== 'false',
    autoBlockDuration: parseInt(process.env.AUTO_BLOCK_DURATION) || 3600000,
    abuseScoreThreshold: parseInt(process.env.ABUSE_SCORE_THRESHOLD) || 100
  },

  // Webhooks
  webhooks: {
    maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES) || 3,
    retryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY) || 5000,
    timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 5000
  }
};

module.exports = config;
