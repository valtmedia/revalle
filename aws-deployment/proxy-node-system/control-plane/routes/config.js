const express = require('express');
const router = express.Router();
const ConfigManager = require('../src/configManager');
const AuthMiddleware = require('../src/middleware/auth');

const configManager = new ConfigManager();

// Get system config
router.get('/system',
  AuthMiddleware,
  async (req, res) => {
    try {
      const config = await configManager.getSystemConfig();
      res.json({ success: true, config });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Update system config
router.put('/system',
  AuthMiddleware,
  async (req, res) => {
    try {
      const config = await configManager.updateSystemConfig(req.body);
      res.json({ success: true, config });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Get node config
router.get('/nodes/:nodeId',
  AuthMiddleware,
  async (req, res) => {
    try {
      const config = await configManager.getNodeConfig(req.params.nodeId);
      res.json({ success: true, config });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Set node config
router.put('/nodes/:nodeId',
  AuthMiddleware,
  async (req, res) => {
    try {
      await configManager.setNodeConfig(req.params.nodeId, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Get all configs
router.get('/all',
  AuthMiddleware,
  async (req, res) => {
    try {
      const configs = await configManager.getAllConfigs();
      res.json({ success: true, configs });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
