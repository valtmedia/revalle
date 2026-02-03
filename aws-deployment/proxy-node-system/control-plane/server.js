const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const NodeManager = require('./src/nodeManager');
const MetricsCollector = require('./src/metricsCollector');
const LoadBalancer = require('./src/loadBalancer');
const UserManager = require('./src/userManager');
const Analytics = require('./src/analytics');
const AlertManager = require('./src/alertManager');
const ConfigManager = require('./src/configManager');
const BackupManager = require('./src/backupManager');
const Scheduler = require('./src/scheduler');
const AuthMiddleware = require('./src/middleware/auth');
const config = require('./config');

// Import routes
const nodesRouter = require('./routes/nodes');
const usersRouter = require('./routes/users');
const analyticsRouter = require('./routes/analytics');
const configRouter = require('./routes/config');
const alertsRouter = require('./routes/alerts');
const backupRouter = require('./routes/backup');
const schedulerRouter = require('./routes/scheduler');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Initialize managers
const nodeManager = new NodeManager();
const metricsCollector = new MetricsCollector();
const loadBalancer = new LoadBalancer(nodeManager);
const userManager = new UserManager();
const analytics = new Analytics();
const alertManager = new AlertManager();
const configManager = new ConfigManager();
const backupManager = new BackupManager();
const scheduler = new Scheduler();

// WebSocket for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('subscribe', (channel) => {
    socket.join(channel);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Broadcast helper
const broadcast = (event, data) => {
  io.emit(event, data);
};

// API Routes
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Mount route modules
app.use('/api/nodes', nodesRouter);
app.use('/api/users', usersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/config', configRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/scheduler', schedulerRouter);

// Legacy endpoints (kept for backward compatibility)
app.post('/api/nodes/register', async (req, res) => {
  try {
    const node = await nodeManager.registerNode(req.body);
    broadcast('node:registered', node);
    await analytics.recordEvent('node:registered', { nodeId: node.id });
    res.json({ success: true, node });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/nodes/:id/heartbeat', async (req, res) => {
  try {
    const node = await nodeManager.updateHeartbeat(req.params.id, req.body);
    broadcast('node:heartbeat', node);
    await analytics.recordEvent('node:heartbeat', { nodeId: node.id });
    res.json({ success: true, node });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Load Balancing
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
app.get('/api/metrics', AuthMiddleware, async (req, res) => {
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

// Statistics
app.get('/api/stats/overview', AuthMiddleware, async (req, res) => {
  try {
    const nodes = await nodeManager.getAllNodes();
    const stats = {
      totalNodes: nodes.length,
      activeNodes: nodes.filter(n => n.status === 'active').length,
      inactiveNodes: nodes.filter(n => n.status === 'inactive').length,
      totalRequests: await metricsCollector.getTotalRequests(),
      averageLatency: await metricsCollector.getAverageLatency(),
      bandwidthUsed: await metricsCollector.getBandwidthUsed(),
      uptime: process.uptime(),
      users: (await userManager.getAllUsers()).length,
      alerts: (await alertManager.getActiveAlerts()).length
    };
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Control Plane API running on port ${PORT}`);
  console.log(`WebSocket server ready`);
  
  // Start scheduler
  scheduler.start();

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

  console.log('Default alert rules initialized');
});

module.exports = app;
