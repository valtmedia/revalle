'use strict';

/**
 * Proxy Node System - Control Plane API
 * 
 * Central management server for the proxy node infrastructure.
 * Handles node registration, load balancing, monitoring, security,
 * user management, webhooks, and more.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Core modules
const NodeManager = require('./src/nodeManager');
const MetricsCollector = require('./src/metricsCollector');
const LoadBalancer = require('./src/loadBalancer');
const UserManager = require('./src/userManager');
const Analytics = require('./src/analytics');
const AlertManager = require('./src/alertManager');
const ConfigManager = require('./src/configManager');
const BackupManager = require('./src/backupManager');
const Scheduler = require('./src/scheduler');
const GeoRouter = require('./src/geoRouter');
const ProxyTunnel = require('./src/proxyTunnel');
const SSLManager = require('./src/sslManager');
const IPManager = require('./src/ipManager');
const WebhookManager = require('./src/webhookManager');
const APIKeyManager = require('./src/apiKeyManager');

// Middleware
const AuthMiddleware = require('./src/middleware/auth');
const requestLogger = require('./src/middleware/requestLogger');
const logger = require('./src/logger');

// Prometheus metrics
const { register: prometheusRegister, httpRequestCounter, httpRequestDuration,
        proxyNodesGauge, proxyActiveConnections, proxyErrorsCounter,
        proxyBytesTransferred } = require('./src/prometheusMetrics');

// Routes
const nodesRouter = require('./routes/nodes');
const usersRouter = require('./routes/users');
const analyticsRouter = require('./routes/analytics');
const configRouter = require('./routes/config');
const alertsRouter = require('./routes/alerts');
const backupRouter = require('./routes/backup');
const schedulerRouter = require('./routes/scheduler');
const tunnelRouter = require('./routes/tunnel');
const geoRouter = require('./routes/geo');
const logsRouter = require('./routes/logs');
const metricsRouter = require('./routes/metrics');
const securityRouter = require('./routes/security');
const webhooksRouter = require('./routes/webhooks');

// Config
const config = require('./config');

// ===========================================
// Application Setup
// ===========================================
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ===========================================
// Initialize Managers
// ===========================================
const nodeManager = new NodeManager();
const metricsCollector = new MetricsCollector();
const loadBalancer = new LoadBalancer(nodeManager);
const userManager = new UserManager();
const analytics = new Analytics();
const alertManager = new AlertManager();
const configManager = new ConfigManager();
const backupManager = new BackupManager();
const scheduler = new Scheduler();
const geoRouterInstance = new GeoRouter(nodeManager);
const proxyTunnel = new ProxyTunnel();
const sslManager = new SSLManager();
const ipManager = new IPManager();
const webhookManager = new WebhookManager();
const apiKeyManager = new APIKeyManager();

// Make managers available to routes via app.locals
app.locals.nodeManager = nodeManager;
app.locals.metricsCollector = metricsCollector;
app.locals.loadBalancer = loadBalancer;
app.locals.userManager = userManager;
app.locals.analytics = analytics;
app.locals.alertManager = alertManager;
app.locals.configManager = configManager;
app.locals.backupManager = backupManager;
app.locals.scheduler = scheduler;
app.locals.geoRouter = geoRouterInstance;
app.locals.proxyTunnel = proxyTunnel;
app.locals.sslManager = sslManager;
app.locals.ipManager = ipManager;
app.locals.webhookManager = webhookManager;
app.locals.apiKeyManager = apiKeyManager;
app.locals.io = io;

// ===========================================
// Global Middleware
// ===========================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for dashboard
  crossOriginEmbedderPolicy: false
}));

// CORS
app.use(cors({
  origin: config.corsOrigins || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  credentials: true,
  maxAge: 86400
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Request ID
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// IP-based security middleware
app.use((req, res, next) => {
  const clientIp = req.ip || req.connection?.remoteAddress || '0.0.0.0';
  
  // Skip for health checks
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const access = ipManager.checkAccess(clientIp);
  if (!access.allowed) {
    logger.warn(`Blocked request from ${clientIp}: ${access.reason}`);
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      reason: access.reason
    });
  }

  // Record request for abuse detection
  ipManager.recordRequest(clientIp, {
    url: req.originalUrl,
    method: req.method,
    userAgent: req.headers['user-agent']
  });

  next();
});

// API Key authentication (alternative to JWT)
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const validation = apiKeyManager.validate(apiKey);
    if (validation.valid) {
      req.apiKeyAuth = true;
      req.user = {
        userId: validation.userId,
        permissions: validation.permissions,
        scopes: validation.scopes,
        keyId: validation.keyId
      };
    }
  }
  next();
});

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.rateLimitMax || 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/health' || req.path === '/ready'
});
app.use('/api/', globalLimiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many authentication attempts.' }
});
app.use('/api/auth/', authLimiter);

// ===========================================
// Health & Readiness Endpoints
// ===========================================

app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime),
    version: require('./package.json').version,
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    }
  });
});

app.get('/ready', async (req, res) => {
  try {
    const checks = {
      nodeManager: nodeManager ? 'ok' : 'error',
      analytics: analytics ? 'ok' : 'error',
      configManager: configManager ? 'ok' : 'error'
    };

    const allOk = Object.values(checks).every(v => v === 'ok');
    res.status(allOk ? 200 : 503).json({
      ready: allOk,
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ ready: false, error: error.message });
  }
});

// ===========================================
// API Routes
// ===========================================

app.use('/api/nodes', nodesRouter);
app.use('/api/users', usersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/config', configRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/scheduler', schedulerRouter);
app.use('/api/tunnel', tunnelRouter);
app.use('/api/geo', geoRouter);
app.use('/api/logs', logsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/security', securityRouter);
app.use('/api/webhooks', webhooksRouter);

// ===========================================
// Prometheus Metrics Endpoint
// ===========================================

app.get('/api/metrics/prometheus', async (req, res) => {
  try {
    // Update node gauges
    const allNodes = await nodeManager.getAllNodes();
    const healthyNodes = allNodes.filter(n => n.health === 'healthy');
    proxyNodesGauge.set({ status: 'total' }, allNodes.length);
    proxyNodesGauge.set({ status: 'healthy' }, healthyNodes.length);
    proxyNodesGauge.set({ status: 'unhealthy' }, allNodes.length - healthyNodes.length);

    res.set('Content-Type', prometheusRegister.contentType);
    res.end(await prometheusRegister.metrics());
  } catch (error) {
    logger.error('Error serving Prometheus metrics:', error);
    res.status(500).end(error.message);
  }
});

// ===========================================
// Node Discovery Endpoint (for Prometheus SD)
// ===========================================

app.get('/api/nodes/discovery', async (req, res) => {
  try {
    const nodes = await nodeManager.getAllNodes();
    const targets = nodes
      .filter(n => n.status === 'active')
      .map(node => ({
        targets: [`${node.host}:${node.metricsPort || 9100}`],
        labels: {
          node_id: node.id,
          node_name: node.name || node.id,
          region: node.region || 'unknown',
          __metrics_path__: '/metrics'
        }
      }));
    res.json(targets);
  } catch (error) {
    logger.error('Error in node discovery:', error);
    res.status(500).json([]);
  }
});

// ===========================================
// Legacy API Endpoints (backward compatibility)
// ===========================================

// Node registration
app.post('/api/nodes/register', async (req, res) => {
  try {
    const node = await nodeManager.registerNode(req.body);
    broadcast('node:registered', node);
    await analytics.recordEvent('node:registered', { nodeId: node.id });
    await webhookManager.trigger('node.registered', { node });
    res.json({ success: true, node });
  } catch (error) {
    logger.error('Node registration error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Node heartbeat
app.post('/api/nodes/:id/heartbeat', async (req, res) => {
  try {
    const node = await nodeManager.updateHeartbeat(req.params.id, req.body);
    broadcast('node:heartbeat', { nodeId: node.id, health: node.health, load: node.currentLoad });
    await analytics.recordEvent('node:heartbeat', { nodeId: node.id });

    // Update Prometheus metrics
    if (req.body.metrics) {
      proxyActiveConnections.set({ node_id: node.id }, req.body.metrics.activeConnections || 0);
    }

    res.json({ success: true, node });
  } catch (error) {
    logger.error('Heartbeat error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Node log ingestion
app.post('/api/nodes/:id/logs', async (req, res) => {
  try {
    const { summary } = req.body;
    if (summary) {
      await analytics.recordProxyRequest(req.params.id, {
        bytes: summary.totalBytes || 0,
        requests: summary.totalRequests || 0,
        errors: summary.errors || 0
      });

      // Update Prometheus metrics
      if (summary.totalBytes) {
        proxyBytesTransferred.inc({ node_id: req.params.id }, summary.totalBytes);
      }
      if (summary.errors) {
        proxyErrorsCounter.inc({ node_id: req.params.id, type: 'proxy' }, summary.errors);
      }
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Log ingestion error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Load balancing
app.get('/api/load-balancer/next-node', async (req, res) => {
  try {
    const node = await loadBalancer.getNextNode(req.query);
    if (!node) {
      return res.status(503).json({ success: false, error: 'No available nodes' });
    }
    res.json({ success: true, node });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/load-balancer/stats', AuthMiddleware, async (req, res) => {
  try {
    const stats = await loadBalancer.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Metrics
app.get('/api/metrics/overview', AuthMiddleware, async (req, res) => {
  try {
    const metrics = await metricsCollector.getMetrics(req.query);
    res.json({ success: true, metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/metrics/nodes/:id', AuthMiddleware, async (req, res) => {
  try {
    const metrics = await metricsCollector.getNodeMetrics(req.params.id, req.query);
    res.json({ success: true, metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Statistics overview
app.get('/api/stats/overview', AuthMiddleware, async (req, res) => {
  try {
    const nodes = await nodeManager.getAllNodes();
    const healthyNodes = nodes.filter(n => n.health === 'healthy');
    const activeAlerts = await alertManager.getActiveAlerts();

    const stats = {
      totalNodes: nodes.length,
      activeNodes: nodes.filter(n => n.status === 'active').length,
      healthyNodes: healthyNodes.length,
      inactiveNodes: nodes.filter(n => n.status === 'inactive').length,
      totalRequests: await metricsCollector.getTotalRequests(),
      averageLatency: await metricsCollector.getAverageLatency(),
      bandwidthUsed: await metricsCollector.getBandwidthUsed(),
      uptime: process.uptime(),
      uptimeFormatted: formatUptime(process.uptime()),
      users: (await userManager.getAllUsers()).length,
      activeAlerts: activeAlerts.length,
      criticalAlerts: activeAlerts.filter(a => a.severity === 'critical').length,
      nodeRegions: [...new Set(nodes.map(n => n.region).filter(Boolean))],
      ipStats: ipManager.getStats(),
      webhookStats: webhookManager.getStats(),
      apiKeyStats: apiKeyManager.getStats(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      timestamp: new Date().toISOString()
    };

    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error getting overview stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===========================================
// WebSocket Management
// ===========================================

io.on('connection', (socket) => {
  logger.info(`WebSocket client connected: ${socket.id}`);

  // Send initial state
  nodeManager.getAllNodes().then(nodes => {
    socket.emit('nodes:state', nodes);
  });

  socket.on('subscribe', (channel) => {
    socket.join(channel);
    logger.debug(`Client ${socket.id} subscribed to ${channel}`);
  });

  socket.on('unsubscribe', (channel) => {
    socket.leave(channel);
    logger.debug(`Client ${socket.id} unsubscribed from ${channel}`);
  });

  socket.on('request:proxy', async (data) => {
    try {
      const node = await loadBalancer.getNextNode(data);
      socket.emit('proxy:assigned', node);
    } catch (error) {
      socket.emit('proxy:error', { error: error.message });
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info(`WebSocket client disconnected: ${socket.id} (${reason})`);
  });
});

// Broadcast helper
function broadcast(event, data) {
  io.emit(event, { ...data, timestamp: new Date().toISOString() });
}

// ===========================================
// Error Handling
// ===========================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error(`Unhandled error: ${err.message}`, {
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    requestId: req.requestId
  });

  // Track errors
  proxyErrorsCounter.inc({ type: 'api', node_id: 'control-plane' });

  res.status(err.status || 500).json({
    success: false,
    error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
    requestId: req.requestId
  });
});

// ===========================================
// Periodic Tasks
// ===========================================

// Node health checker (every 60s)
const healthCheckInterval = setInterval(async () => {
  try {
    const nodes = await nodeManager.getAllNodes();
    const now = Date.now();

    for (const node of nodes) {
      const lastHeartbeat = new Date(node.lastHeartbeat || node.registeredAt).getTime();
      const timeSinceHeartbeat = now - lastHeartbeat;

      if (timeSinceHeartbeat > config.node.inactiveThreshold && node.health !== 'unhealthy') {
        node.health = 'unhealthy';
        logger.warn(`Node ${node.id} marked unhealthy (no heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s)`);
        broadcast('node:health_changed', { nodeId: node.id, health: 'unhealthy' });
        await webhookManager.trigger('node.health_changed', {
          nodeId: node.id,
          previousHealth: 'healthy',
          newHealth: 'unhealthy'
        });
        await alertManager.createAlert({
          type: 'node_unhealthy',
          severity: 'critical',
          message: `Node ${node.name || node.id} is unhealthy`,
          nodeId: node.id
        });
      }
    }

    // Update Prometheus gauges
    const healthyCount = nodes.filter(n => n.health === 'healthy').length;
    proxyNodesGauge.set({ status: 'healthy' }, healthyCount);
    proxyNodesGauge.set({ status: 'total' }, nodes.length);
  } catch (error) {
    logger.error('Health check error:', error);
  }
}, config.node.healthCheckInterval || 60000);

// Metrics aggregation (every 5 min)
const metricsInterval = setInterval(async () => {
  try {
    const analyticsStats = await analytics.getStats('5m');
    broadcast('metrics:update', analyticsStats);
  } catch (error) {
    logger.error('Metrics aggregation error:', error);
  }
}, 300000);

// Session cleanup (every 30 min)
const sessionCleanupInterval = setInterval(async () => {
  try {
    // Clean expired sessions, old analytics data, etc.
    logger.info('Running periodic cleanup...');
  } catch (error) {
    logger.error('Cleanup error:', error);
  }
}, 1800000);

// ===========================================
// Graceful Shutdown
// ===========================================

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Fire shutdown webhook
  try {
    await webhookManager.trigger('system.shutdown', { signal, timestamp: new Date().toISOString() });
  } catch {}

  // Stop accepting new connections
  httpServer.close(() => {
    logger.info('HTTP server closed');
  });

  // Close WebSocket connections
  io.close(() => {
    logger.info('WebSocket server closed');
  });

  // Stop periodic tasks
  clearInterval(healthCheckInterval);
  clearInterval(metricsInterval);
  clearInterval(sessionCleanupInterval);

  // Shutdown managers
  try {
    scheduler.stop();
    ipManager.shutdown();
    webhookManager.shutdown();
    logger.info('All managers shut down');
  } catch (error) {
    logger.error('Error during shutdown:', error);
  }

  // Wait for in-flight requests (max 10s)
  setTimeout(() => {
    logger.info('Shutdown complete');
    process.exit(0);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  proxyErrorsCounter.inc({ type: 'uncaught', node_id: 'control-plane' });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  proxyErrorsCounter.inc({ type: 'unhandled_rejection', node_id: 'control-plane' });
});

// ===========================================
// Helpers
// ===========================================

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

// ===========================================
// Start Server
// ===========================================

if (process.env.NODE_ENV !== 'test') {
  const PORT = config.port || 3000;
  httpServer.listen(PORT, '0.0.0.0', async () => {
    logger.info(`===========================================`);
    logger.info(`  Proxy Node System - Control Plane`);
    logger.info(`  Version: ${require('./package.json').version}`);
    logger.info(`  Port: ${PORT}`);
    logger.info(`  Environment: ${config.nodeEnv || 'development'}`);
    logger.info(`  PID: ${process.pid}`);
    logger.info(`===========================================`);

    // Initialize SSL Manager
    try {
      await sslManager.initializeCA();
      logger.info('SSL Manager initialized');
    } catch (error) {
      logger.warn('SSL Manager initialization failed (non-critical):', error.message);
    }

    // Start scheduler
    scheduler.start();
    logger.info('Scheduler started');

    // Initialize default alert rules
    alertManager.addRule({
      name: 'Node Down Alert',
      condition: 'node_down',
      threshold: 1,
      severity: 'critical',
      action: 'notify'
    });

    alertManager.addRule({
      name: 'High Latency Alert',
      condition: 'high_latency',
      threshold: 1000,
      severity: 'warning',
      action: 'notify'
    });

    alertManager.addRule({
      name: 'Low Availability Alert',
      condition: 'low_availability',
      threshold: 50,
      severity: 'critical',
      action: 'scale'
    });

    alertManager.addRule({
      name: 'High Error Rate',
      condition: 'high_error_rate',
      threshold: 5,
      severity: 'warning',
      action: 'notify'
    });

    logger.info('Default alert rules initialized');

    // Fire startup webhook
    webhookManager.trigger('system.startup', {
      port: PORT,
      pid: process.pid,
      nodeVersion: process.version
    });

    logger.info('Control Plane is ready to accept connections');
  });
}

module.exports = app;
