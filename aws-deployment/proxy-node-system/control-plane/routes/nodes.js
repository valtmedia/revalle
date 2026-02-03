const express = require('express');
const router = express.Router();
const NodeManager = require('../src/nodeManager');
const RateLimiter = require('../src/rateLimiter');
const Analytics = require('../src/analytics');
const validator = require('../src/middleware/validator');
const AuthMiddleware = require('../src/middleware/auth');

const nodeManager = new NodeManager();
const rateLimiter = new RateLimiter();
const analytics = new Analytics();

// Register node (public, but rate limited)
router.post('/register',
  validator.validateNodeRegistration,
  async (req, res) => {
    try {
      const limit = await rateLimiter.checkIPLimit(req.ip, 10, 3600);
      if (!limit.allowed) {
        return res.status(429).json({
          success: false,
          error: 'Registration rate limit exceeded'
        });
      }

      const node = await nodeManager.registerNode(req.body);
      await analytics.recordEvent('node:registered', { nodeId: node.id });
      
      res.json({ success: true, node });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Get all nodes
router.get('/',
  AuthMiddleware,
  async (req, res) => {
    try {
      const nodes = await nodeManager.getAllNodes();
      const { page = 1, limit = 20 } = req.query;
      const start = (page - 1) * limit;
      const end = start + parseInt(limit);

      res.json({
        success: true,
        nodes: nodes.slice(start, end),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: nodes.length,
          pages: Math.ceil(nodes.length / limit)
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get node by ID
router.get('/:id',
  AuthMiddleware,
  async (req, res) => {
    try {
      const node = await nodeManager.getNode(req.params.id);
      if (!node) {
        return res.status(404).json({ success: false, error: 'Node not found' });
      }
      res.json({ success: true, node });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Update node
router.put('/:id',
  AuthMiddleware,
  async (req, res) => {
    try {
      const node = await nodeManager.updateNode(req.params.id, req.body);
      await analytics.recordEvent('node:updated', { nodeId: node.id });
      res.json({ success: true, node });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Delete node
router.delete('/:id',
  AuthMiddleware,
  async (req, res) => {
    try {
      await nodeManager.removeNode(req.params.id);
      await analytics.recordEvent('node:removed', { nodeId: req.params.id });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Heartbeat
router.post('/:id/heartbeat',
  async (req, res) => {
    try {
      const node = await nodeManager.updateHeartbeat(req.params.id, req.body);
      await analytics.recordEvent('node:heartbeat', { nodeId: node.id });
      res.json({ success: true, node });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Get node metrics
router.get('/:id/metrics',
  AuthMiddleware,
  async (req, res) => {
    try {
      const { startTime, endTime } = req.query;
      const metrics = await analytics.getNodeMetrics(req.params.id, {
        startTime,
        endTime
      });
      res.json({ success: true, metrics });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get node stats
router.get('/:id/stats',
  AuthMiddleware,
  async (req, res) => {
    try {
      const node = await nodeManager.getNode(req.params.id);
      if (!node) {
        return res.status(404).json({ success: false, error: 'Node not found' });
      }

      const stats = {
        node,
        metrics: await analytics.getNodeMetrics(req.params.id),
        uptime: node.lastHeartbeat ? 
          Date.now() - new Date(node.lastHeartbeat).getTime() : 0
      };

      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
