'use strict';

const logger = require('../logger');
const { accessLogger, perfLogger } = require('../logger');
const { httpRequestCounter, httpRequestDuration } = require('../prometheusMetrics');

/**
 * Request/response logging middleware
 * Logs every HTTP request with timing, status, and context
 */
function requestLoggerMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();
  const startMs = Date.now();

  // Capture original end to intercept response
  const originalEnd = res.end;
  let responseBody = '';

  res.end = function(chunk, encoding) {
    if (chunk) {
      responseBody = chunk.toString();
    }

    const endTime = process.hrtime.bigint();
    const durationNs = Number(endTime - startTime);
    const durationMs = durationNs / 1e6;
    const durationSec = durationNs / 1e9;

    // Log access entry
    const logEntry = {
      requestId: req.requestId || '-',
      method: req.method,
      url: req.originalUrl || req.url,
      path: req.path,
      statusCode: res.statusCode,
      contentLength: res.getHeader('content-length') || responseBody.length,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection?.remoteAddress,
      userId: req.user?.userId || null,
      duration: durationMs.toFixed(2) + 'ms',
      durationMs: parseFloat(durationMs.toFixed(2)),
      timestamp: new Date(startMs).toISOString()
    };

    // Use accessLogger if available, fallback to main logger
    if (accessLogger && accessLogger.info) {
      accessLogger.info('HTTP Request', logEntry);
    }

    // Record Prometheus metrics
    const pathLabel = normalizePath(req.path);
    try {
      httpRequestCounter.inc({
        method: req.method,
        route: pathLabel,
        status: res.statusCode
      });

      httpRequestDuration.observe({
        method: req.method,
        route: pathLabel,
        status: res.statusCode
      }, durationSec);
    } catch {
      // Metrics recording is non-critical
    }

    // Log slow requests
    if (durationMs > 1000 && perfLogger && perfLogger.warn) {
      perfLogger.warn('Slow request detected', {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        duration: durationMs.toFixed(2) + 'ms',
        statusCode: res.statusCode
      });
    }

    // Call original end
    originalEnd.call(this, chunk, encoding);
  };

  next();
}

/**
 * Normalize path for metric labels (avoid cardinality explosion)
 */
function normalizePath(path) {
  if (!path) return '/unknown';

  return path
    .replace(/\/[a-f0-9-]{20,}/g, '/:id')      // UUIDs and hex IDs
    .replace(/\/node-[a-z0-9-]+/g, '/:nodeId')   // Node IDs
    .replace(/\/user-[a-z0-9-]+/g, '/:userId')   // User IDs
    .replace(/\/\d+/g, '/:num')                   // Numeric IDs
    .replace(/\/backup-[^/]+/g, '/:backupId');    // Backup filenames
}

module.exports = requestLoggerMiddleware;
