const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Custom format for structured logging
const structuredFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message} ${metaStr}`;
});

// Color coding for console
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  structuredFormat
);

// JSON format for file logging
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Daily rotate transport creator
function createRotateTransport(filename, level, maxFiles = '14d') {
  return new winston.transports.File({
    filename: path.join(LOG_DIR, filename),
    level,
    maxsize: 10 * 1024 * 1024, // 10MB per file
    maxFiles: 14,
    format: fileFormat,
    tailable: true
  });
}

// Main application logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: {
    service: 'proxy-control-plane',
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid
  },
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat,
      handleExceptions: true,
      handleRejections: true
    }),
    // Combined log
    createRotateTransport('combined.log', 'info'),
    // Error log
    createRotateTransport('error.log', 'error'),
    // Debug log
    createRotateTransport('debug.log', 'debug')
  ],
  exitOnError: false
});

// Access logger for HTTP requests
const accessLogger = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'proxy-access' },
  transports: [
    createRotateTransport('access.log', 'info')
  ],
  format: fileFormat
});

// Audit logger for sensitive operations
const auditLogger = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'proxy-audit' },
  transports: [
    createRotateTransport('audit.log', 'info')
  ],
  format: fileFormat
});

// Metrics logger
const metricsLogger = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'proxy-metrics' },
  transports: [
    createRotateTransport('metrics.log', 'info')
  ],
  format: fileFormat
});

// Performance logger
const perfLogger = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'proxy-performance' },
  transports: [
    createRotateTransport('performance.log', 'info')
  ],
  format: fileFormat
});

// Helper to create child loggers with context
logger.child = function(metadata) {
  return winston.createLogger({
    level: this.level,
    defaultMeta: { ...this.defaultMeta, ...metadata },
    transports: this.transports,
    format: this.format
  });
};

// Log rotation cleanup
function cleanupOldLogs(daysToKeep = 30) {
  const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
  
  try {
    const files = fs.readdirSync(LOG_DIR);
    files.forEach(file => {
      const filepath = path.join(LOG_DIR, file);
      const stat = fs.statSync(filepath);
      if (stat.mtimeMs < cutoff && file.endsWith('.log')) {
        fs.unlinkSync(filepath);
        logger.info(`Cleaned up old log file: ${file}`);
      }
    });
  } catch (err) {
    logger.error('Error cleaning up log files:', err);
  }
}

// Query logs (for API access)
async function queryLogs(options = {}) {
  const { level, service, startTime, endTime, limit = 100, search } = options;
  const logFile = level === 'error' ? 'error.log' : 'combined.log';
  const filepath = path.join(LOG_DIR, logFile);
  
  try {
    if (!fs.existsSync(filepath)) {
      return [];
    }
    
    const content = fs.readFileSync(filepath, 'utf8');
    let lines = content.split('\n').filter(Boolean);
    
    // Parse JSON lines
    let entries = lines.map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);
    
    // Apply filters
    if (level) {
      entries = entries.filter(e => e.level === level);
    }
    if (service) {
      entries = entries.filter(e => e.service === service);
    }
    if (startTime) {
      entries = entries.filter(e => new Date(e.timestamp) >= new Date(startTime));
    }
    if (endTime) {
      entries = entries.filter(e => new Date(e.timestamp) <= new Date(endTime));
    }
    if (search) {
      const regex = new RegExp(search, 'i');
      entries = entries.filter(e => regex.test(e.message) || regex.test(JSON.stringify(e)));
    }
    
    return entries.slice(-limit);
  } catch (err) {
    logger.error('Error querying logs:', err);
    return [];
  }
}

// Get log statistics
function getLogStats() {
  const stats = {};
  
  try {
    const files = fs.readdirSync(LOG_DIR);
    files.forEach(file => {
      if (file.endsWith('.log')) {
        const filepath = path.join(LOG_DIR, file);
        const fileStat = fs.statSync(filepath);
        stats[file] = {
          size: fileStat.size,
          sizeHuman: formatBytes(fileStat.size),
          modified: fileStat.mtime,
          created: fileStat.birthtime
        };
      }
    });
  } catch (err) {
    // Directory might not exist yet
  }
  
  return stats;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Export logger as default + named exports for backward compatibility
// Usage: const logger = require('./logger');          -> main logger
//   OR:  const { accessLogger } = require('./logger'); -> specific loggers
module.exports = logger;
module.exports.logger = logger;
module.exports.accessLogger = accessLogger;
module.exports.auditLogger = auditLogger;
module.exports.metricsLogger = metricsLogger;
module.exports.perfLogger = perfLogger;
module.exports.cleanupOldLogs = cleanupOldLogs;
module.exports.queryLogs = queryLogs;
module.exports.getLogStats = getLogStats;
