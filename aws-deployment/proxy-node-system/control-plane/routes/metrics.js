const express = require('express');
const router = express.Router();
const AuthMiddleware = require('../src/middleware/auth');
const prometheusMetrics = require('../src/prometheusMetrics');

// Prometheus metrics endpoint (no auth - for scraping)
router.get('/prometheus', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(prometheusMetrics.generateMetrics());
});

// JSON metrics endpoint
router.get('/json',
  AuthMiddleware,
  (req, res) => {
    res.json({
      success: true,
      metrics: prometheusMetrics.getMetricsJSON()
    });
  }
);

// Reset metrics (admin only)
router.post('/reset',
  AuthMiddleware,
  (req, res) => {
    prometheusMetrics.reset();
    res.json({ success: true, message: 'Metrics reset' });
  }
);

module.exports = router;
