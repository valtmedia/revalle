const express = require('express');
const router = express.Router();
const AlertManager = require('../src/alertManager');
const AuthMiddleware = require('../src/middleware/auth');

const alertManager = new AlertManager();

// Add alert rule
router.post('/rules',
  AuthMiddleware,
  async (req, res) => {
    try {
      alertManager.addRule(req.body);
      res.json({ success: true, message: 'Alert rule added' });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Get alert history
router.get('/history',
  AuthMiddleware,
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const alerts = await alertManager.getAlertHistory(limit);
      res.json({ success: true, alerts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get active alerts
router.get('/active',
  AuthMiddleware,
  async (req, res) => {
    try {
      const alerts = await alertManager.getActiveAlerts();
      res.json({ success: true, alerts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Check alerts (manual trigger)
router.post('/check',
  AuthMiddleware,
  async (req, res) => {
    try {
      const alerts = await alertManager.checkAlerts();
      res.json({ success: true, alerts, count: alerts.length });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
