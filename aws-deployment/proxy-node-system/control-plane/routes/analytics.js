const express = require('express');
const router = express.Router();
const Analytics = require('../src/analytics');
const AuthMiddleware = require('../src/middleware/auth');
const validator = require('../src/middleware/validator');

const analytics = new Analytics();

// Get analytics stats
router.get('/stats',
  AuthMiddleware,
  async (req, res) => {
    try {
      const timeRange = req.query.range || '24h';
      const stats = await analytics.getStats(timeRange);
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get hourly stats
router.get('/hourly',
  AuthMiddleware,
  async (req, res) => {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const stats = await analytics.getHourlyStats(hours);
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get top nodes
router.get('/top-nodes',
  AuthMiddleware,
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const nodes = await analytics.getTopNodes(limit);
      res.json({ success: true, nodes });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get geographic stats
router.get('/geographic',
  AuthMiddleware,
  async (req, res) => {
    try {
      const stats = await analytics.getGeographicStats();
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get error stats
router.get('/errors',
  AuthMiddleware,
  async (req, res) => {
    try {
      const errors = await analytics.getErrorStats();
      res.json({ success: true, errors });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Export data
router.get('/export',
  AuthMiddleware,
  async (req, res) => {
    try {
      const format = req.query.format || 'json';
      const data = await analytics.exportData(format);

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=analytics.csv');
        return res.send(data);
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=analytics.json');
      res.send(data);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
