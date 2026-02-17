const express = require('express');
const router = express.Router();
const AuthMiddleware = require('../src/middleware/auth');
const { queryLogs, getLogStats } = require('../src/logger');

let auditLog = null;

router.init = function(al) {
  auditLog = al;
};

// Get application logs
router.get('/app',
  AuthMiddleware,
  async (req, res) => {
    try {
      const { level, service, search, limit } = req.query;
      const logs = await queryLogs({
        level,
        service,
        search,
        limit: parseInt(limit) || 100
      });
      res.json({ success: true, logs, count: logs.length });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get log file stats
router.get('/stats',
  AuthMiddleware,
  async (req, res) => {
    try {
      const stats = getLogStats();
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get audit logs
router.get('/audit',
  AuthMiddleware,
  async (req, res) => {
    try {
      const { userId, action, category, severity, startTime, endTime, page, limit } = req.query;
      
      const results = await auditLog.query({
        userId,
        action,
        category,
        severity,
        startTime,
        endTime
      }, {
        skip: ((parseInt(page) || 1) - 1) * (parseInt(limit) || 50),
        limit: parseInt(limit) || 50
      });
      
      res.json({ success: true, ...results });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get audit summary
router.get('/audit/summary',
  AuthMiddleware,
  async (req, res) => {
    try {
      const timeRange = req.query.range || '24h';
      const summary = await auditLog.getSummary(timeRange);
      res.json({ success: true, summary });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Verify audit log integrity
router.get('/audit/verify',
  AuthMiddleware,
  async (req, res) => {
    try {
      const result = await auditLog.verifyIntegrity();
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Export audit logs
router.get('/audit/export',
  AuthMiddleware,
  async (req, res) => {
    try {
      const format = req.query.format || 'json';
      const data = await auditLog.export(req.query, format);
      
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=audit-log.csv');
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=audit-log.json');
      }
      
      res.send(data);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get audit log stats
router.get('/audit/stats',
  AuthMiddleware,
  async (req, res) => {
    try {
      const stats = await auditLog.getStats();
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
