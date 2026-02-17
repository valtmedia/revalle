'use strict';

/**
 * Webhook Routes
 */

const express = require('express');
const router = express.Router();
const WebhookManager = require('../src/webhookManager');
const AuthMiddleware = require('../src/middleware/auth');
const logger = require('../src/logger');

const webhookManager = new WebhookManager();

// Register webhook
router.post('/', AuthMiddleware, (req, res) => {
  const { name, url, events, retryCount, retryDelay, timeoutMs, headers } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL is required' });
  }

  try {
    const webhook = webhookManager.register({
      name,
      url,
      events,
      retryCount,
      retryDelay,
      timeoutMs,
      headers
    });
    res.status(201).json({ success: true, webhook });
  } catch (error) {
    logger.error('Error registering webhook:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// List webhooks
router.get('/', AuthMiddleware, (req, res) => {
  try {
    const webhooks = webhookManager.list();
    res.json({ success: true, webhooks });
  } catch (error) {
    logger.error('Error listing webhooks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get webhook by ID
router.get('/:id', AuthMiddleware, (req, res) => {
  try {
    const webhook = webhookManager.get(req.params.id);
    if (!webhook) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }
    res.json({ success: true, webhook });
  } catch (error) {
    logger.error('Error getting webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update webhook
router.put('/:id', AuthMiddleware, (req, res) => {
  try {
    const webhook = webhookManager.update(req.params.id, req.body);
    res.json({ success: true, webhook });
  } catch (error) {
    logger.error('Error updating webhook:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Delete webhook
router.delete('/:id', AuthMiddleware, (req, res) => {
  try {
    const deleted = webhookManager.delete(req.params.id);
    res.json({ success: true, deleted });
  } catch (error) {
    logger.error('Error deleting webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test webhook (send test event)
router.post('/:id/test', AuthMiddleware, async (req, res) => {
  try {
    const webhook = webhookManager.get(req.params.id);
    if (!webhook) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    const result = await webhookManager.trigger('test.webhook', {
      message: 'This is a test webhook delivery',
      webhookId: req.params.id,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, result });
  } catch (error) {
    logger.error('Error testing webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get delivery history
router.get('/:id/deliveries', AuthMiddleware, (req, res) => {
  try {
    const { limit, offset, success } = req.query;
    const history = webhookManager.getDeliveryHistory({
      webhookId: req.params.id,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      success: success !== undefined ? success === 'true' : undefined
    });
    res.json({ success: true, ...history });
  } catch (error) {
    logger.error('Error getting delivery history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get webhook stats
router.get('/stats/overview', AuthMiddleware, (req, res) => {
  try {
    const stats = webhookManager.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error getting webhook stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get supported events
router.get('/events/list', AuthMiddleware, (req, res) => {
  try {
    const stats = webhookManager.getStats();
    res.json({ success: true, events: stats.supportedEvents });
  } catch (error) {
    logger.error('Error getting events:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export webhook manager for server.js integration
router.webhookManager = webhookManager;

module.exports = router;
