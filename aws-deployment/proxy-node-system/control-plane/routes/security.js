'use strict';

/**
 * Security Routes - IP management, abuse detection, API keys
 */

const express = require('express');
const router = express.Router();
const IPManager = require('../src/ipManager');
const APIKeyManager = require('../src/apiKeyManager');
const AuthMiddleware = require('../src/middleware/auth');
const logger = require('../src/logger');

const ipManager = new IPManager();
const apiKeyManager = new APIKeyManager();

// ===========================================
// IP Whitelist
// ===========================================

// Get whitelist
router.get('/ip/whitelist', AuthMiddleware, (req, res) => {
  try {
    res.json({ success: true, whitelist: ipManager.getWhitelist() });
  } catch (error) {
    logger.error('Error getting whitelist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add to whitelist
router.post('/ip/whitelist', AuthMiddleware, (req, res) => {
  const { ip, reason, expiresAt, cidr } = req.body;
  if (!ip) return res.status(400).json({ success: false, error: 'IP address is required' });

  try {
    const entry = ipManager.addToWhitelist(ip, {
      reason,
      expiresAt,
      cidr,
      createdBy: req.user?.username || 'api'
    });
    res.json({ success: true, entry });
  } catch (error) {
    logger.error('Error adding to whitelist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove from whitelist
router.delete('/ip/whitelist/:ip', AuthMiddleware, (req, res) => {
  try {
    const removed = ipManager.removeFromWhitelist(req.params.ip);
    res.json({ success: true, removed });
  } catch (error) {
    logger.error('Error removing from whitelist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===========================================
// IP Blacklist
// ===========================================

// Get blacklist
router.get('/ip/blacklist', AuthMiddleware, (req, res) => {
  try {
    res.json({ success: true, blacklist: ipManager.getBlacklist() });
  } catch (error) {
    logger.error('Error getting blacklist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add to blacklist
router.post('/ip/blacklist', AuthMiddleware, (req, res) => {
  const { ip, reason, expiresAt, cidr } = req.body;
  if (!ip) return res.status(400).json({ success: false, error: 'IP address is required' });

  try {
    const entry = ipManager.addToBlacklist(ip, {
      reason,
      expiresAt,
      cidr,
      createdBy: req.user?.username || 'api'
    });
    res.json({ success: true, entry });
  } catch (error) {
    logger.error('Error adding to blacklist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove from blacklist
router.delete('/ip/blacklist/:ip', AuthMiddleware, (req, res) => {
  try {
    const removed = ipManager.removeFromBlacklist(req.params.ip);
    res.json({ success: true, removed });
  } catch (error) {
    logger.error('Error removing from blacklist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===========================================
// Access Check
// ===========================================

// Check if an IP has access
router.get('/ip/check/:ip', AuthMiddleware, (req, res) => {
  try {
    const result = ipManager.checkAccess(req.params.ip);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error checking access:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===========================================
// Abuse Detection
// ===========================================

// Get abuse report
router.get('/abuse/report', AuthMiddleware, (req, res) => {
  try {
    const report = ipManager.getAbuseReport();
    res.json({ success: true, report });
  } catch (error) {
    logger.error('Error getting abuse report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get abuse score for specific IP
router.get('/abuse/:ip', AuthMiddleware, (req, res) => {
  try {
    const score = ipManager.getAbuseScore(req.params.ip);
    res.json({ success: true, ip: req.params.ip, ...score });
  } catch (error) {
    logger.error('Error getting abuse score:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update abuse detection config
router.put('/abuse/config', AuthMiddleware, (req, res) => {
  try {
    const config = ipManager.updateConfig(req.body);
    res.json({ success: true, config });
  } catch (error) {
    logger.error('Error updating abuse config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===========================================
// IP Rules Import/Export
// ===========================================

// Export rules
router.get('/ip/export', AuthMiddleware, (req, res) => {
  try {
    const rules = ipManager.exportRules();
    res.json({ success: true, ...rules });
  } catch (error) {
    logger.error('Error exporting IP rules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Import rules
router.post('/ip/import', AuthMiddleware, (req, res) => {
  try {
    const result = ipManager.importRules(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error importing IP rules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===========================================
// API Key Management
// ===========================================

// Generate new API key
router.post('/api-keys', AuthMiddleware, (req, res) => {
  const { name, permissions, scopes, rpm, daily, monthly, expiresAt } = req.body;
  
  try {
    const key = apiKeyManager.generate(req.user?.userId || 'admin', {
      name,
      permissions,
      scopes,
      rpm,
      daily,
      monthly,
      expiresAt
    });
    res.json({ success: true, key });
  } catch (error) {
    logger.error('Error generating API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List API keys for current user
router.get('/api-keys', AuthMiddleware, (req, res) => {
  try {
    const userId = req.query.userId || req.user?.userId || 'admin';
    const keys = apiKeyManager.getKeysByUser(userId);
    res.json({ success: true, keys });
  } catch (error) {
    logger.error('Error listing API keys:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Revoke API key
router.post('/api-keys/:keyId/revoke', AuthMiddleware, (req, res) => {
  try {
    const revoked = apiKeyManager.revoke(req.params.keyId);
    res.json({ success: true, revoked });
  } catch (error) {
    logger.error('Error revoking API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete API key
router.delete('/api-keys/:keyId', AuthMiddleware, (req, res) => {
  try {
    const deleted = apiKeyManager.delete(req.params.keyId);
    res.json({ success: true, deleted });
  } catch (error) {
    logger.error('Error deleting API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get API key usage
router.get('/api-keys/:keyId/usage', AuthMiddleware, (req, res) => {
  try {
    const usage = apiKeyManager.getUsage(req.params.keyId);
    if (!usage) return res.status(404).json({ success: false, error: 'Key not found' });
    res.json({ success: true, usage });
  } catch (error) {
    logger.error('Error getting API key usage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===========================================
// Security Stats
// ===========================================

// Get combined security stats
router.get('/stats', AuthMiddleware, (req, res) => {
  try {
    res.json({
      success: true,
      ipStats: ipManager.getStats(),
      apiKeyStats: apiKeyManager.getStats()
    });
  } catch (error) {
    logger.error('Error getting security stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export managers for use in server.js
router.ipManager = ipManager;
router.apiKeyManager = apiKeyManager;

module.exports = router;
