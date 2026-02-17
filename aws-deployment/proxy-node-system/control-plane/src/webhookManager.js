'use strict';

/**
 * Webhook Manager
 * Manages webhook subscriptions and delivery
 */

const crypto = require('crypto');
const logger = require('./logger');

class WebhookManager {
  constructor() {
    this.webhooks = new Map();
    this.deliveryQueue = [];
    this.deliveryHistory = [];
    this.maxHistorySize = 1000;
    this.processing = false;

    // Supported events
    this.supportedEvents = [
      'node.registered',
      'node.deregistered',
      'node.health_changed',
      'node.overloaded',
      'alert.created',
      'alert.resolved',
      'user.created',
      'user.suspended',
      'config.changed',
      'backup.completed',
      'backup.failed',
      'system.error',
      'system.startup',
      'system.shutdown',
      'security.ip_blocked',
      'security.abuse_detected',
      'proxy.connection_spike',
      'proxy.error_rate_high'
    ];

    // Start delivery processor
    this._startProcessor();

    logger.info(`WebhookManager initialized with ${this.supportedEvents.length} event types`);
  }

  // ===========================================
  // Webhook CRUD
  // ===========================================

  register(options) {
    const id = `wh-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const secret = options.secret || crypto.randomBytes(32).toString('hex');

    // Validate events
    const invalidEvents = (options.events || []).filter(e => !this.supportedEvents.includes(e) && e !== '*');
    if (invalidEvents.length > 0) {
      throw new Error(`Invalid events: ${invalidEvents.join(', ')}`);
    }

    const webhook = {
      id,
      name: options.name || `Webhook ${id}`,
      url: options.url,
      events: options.events || ['*'],
      secret,
      enabled: options.enabled !== false,
      retryCount: options.retryCount || 3,
      retryDelay: options.retryDelay || 5000,
      timeoutMs: options.timeoutMs || 5000,
      headers: options.headers || {},
      failureCount: 0,
      successCount: 0,
      lastTriggered: null,
      lastStatus: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.webhooks.set(id, webhook);
    logger.info(`Webhook registered: ${webhook.name} (${id}) for events: ${webhook.events.join(', ')}`);

    return {
      ...webhook,
      // Return secret only on creation
      secret
    };
  }

  update(id, updates) {
    const webhook = this.webhooks.get(id);
    if (!webhook) {
      throw new Error(`Webhook ${id} not found`);
    }

    // Validate events if being updated
    if (updates.events) {
      const invalidEvents = updates.events.filter(e => !this.supportedEvents.includes(e) && e !== '*');
      if (invalidEvents.length > 0) {
        throw new Error(`Invalid events: ${invalidEvents.join(', ')}`);
      }
    }

    const allowedFields = ['name', 'url', 'events', 'enabled', 'retryCount', 'retryDelay', 'timeoutMs', 'headers'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        webhook[field] = updates[field];
      }
    }

    webhook.updatedAt = new Date().toISOString();
    logger.info(`Webhook updated: ${webhook.name} (${id})`);
    return this._sanitize(webhook);
  }

  delete(id) {
    const existed = this.webhooks.delete(id);
    if (existed) {
      logger.info(`Webhook deleted: ${id}`);
    }
    return existed;
  }

  get(id) {
    const webhook = this.webhooks.get(id);
    return webhook ? this._sanitize(webhook) : null;
  }

  list() {
    return Array.from(this.webhooks.values()).map(w => this._sanitize(w));
  }

  // ===========================================
  // Event Triggering
  // ===========================================

  async trigger(event, payload = {}) {
    const matchingWebhooks = Array.from(this.webhooks.values()).filter(w => {
      if (!w.enabled) return false;
      return w.events.includes('*') || w.events.includes(event);
    });

    if (matchingWebhooks.length === 0) return { delivered: 0 };

    const deliveryId = `del-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const eventPayload = {
      id: deliveryId,
      event,
      timestamp: new Date().toISOString(),
      data: payload
    };

    for (const webhook of matchingWebhooks) {
      this.deliveryQueue.push({
        deliveryId,
        webhookId: webhook.id,
        webhookUrl: webhook.url,
        event,
        payload: eventPayload,
        secret: webhook.secret,
        headers: webhook.headers,
        timeoutMs: webhook.timeoutMs,
        retryCount: webhook.retryCount,
        retryDelay: webhook.retryDelay,
        attempt: 0,
        createdAt: Date.now()
      });
    }

    logger.info(`Event ${event} queued for ${matchingWebhooks.length} webhooks`);
    return { delivered: matchingWebhooks.length, deliveryId };
  }

  // ===========================================
  // Delivery History
  // ===========================================

  getDeliveryHistory(options = {}) {
    let history = [...this.deliveryHistory];

    if (options.webhookId) {
      history = history.filter(h => h.webhookId === options.webhookId);
    }
    if (options.event) {
      history = history.filter(h => h.event === options.event);
    }
    if (options.success !== undefined) {
      history = history.filter(h => h.success === options.success);
    }

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    return {
      total: history.length,
      items: history.slice(offset, offset + limit)
    };
  }

  // ===========================================
  // Stats
  // ===========================================

  getStats() {
    const webhooks = Array.from(this.webhooks.values());
    return {
      totalWebhooks: webhooks.length,
      enabledWebhooks: webhooks.filter(w => w.enabled).length,
      queueLength: this.deliveryQueue.length,
      historySize: this.deliveryHistory.length,
      totalDelivered: webhooks.reduce((sum, w) => sum + w.successCount, 0),
      totalFailed: webhooks.reduce((sum, w) => sum + w.failureCount, 0),
      supportedEvents: this.supportedEvents
    };
  }

  // ===========================================
  // Private Methods
  // ===========================================

  _startProcessor() {
    this._processorInterval = setInterval(async () => {
      if (this.processing || this.deliveryQueue.length === 0) return;

      this.processing = true;
      try {
        // Process up to 10 deliveries per cycle
        const batch = this.deliveryQueue.splice(0, 10);
        await Promise.allSettled(batch.map(d => this._deliver(d)));
      } catch (err) {
        logger.error('Webhook processor error:', err);
      } finally {
        this.processing = false;
      }
    }, 1000);
  }

  async _deliver(delivery) {
    delivery.attempt++;
    const startTime = Date.now();

    try {
      // Create HMAC signature
      const payloadStr = JSON.stringify(delivery.payload);
      const signature = crypto
        .createHmac('sha256', delivery.secret)
        .update(payloadStr)
        .digest('hex');

      const headers = {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': delivery.event,
        'X-Webhook-Delivery': delivery.deliveryId,
        'X-Webhook-Attempt': delivery.attempt.toString(),
        'User-Agent': 'ProxyNodeSystem-Webhook/1.0',
        ...delivery.headers
      };

      // Use native fetch or http module
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), delivery.timeoutMs);

      let response;
      try {
        response = await fetch(delivery.webhookUrl, {
          method: 'POST',
          headers,
          body: payloadStr,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const duration = Date.now() - startTime;
      const success = response.status >= 200 && response.status < 300;

      // Update webhook stats
      const webhook = this.webhooks.get(delivery.webhookId);
      if (webhook) {
        webhook.lastTriggered = new Date().toISOString();
        webhook.lastStatus = response.status;
        if (success) {
          webhook.successCount++;
          webhook.failureCount = 0; // Reset consecutive failures
        } else {
          webhook.failureCount++;
        }

        // Disable webhook after too many consecutive failures
        if (webhook.failureCount >= 10) {
          webhook.enabled = false;
          logger.warn(`Webhook ${webhook.id} disabled after 10 consecutive failures`);
        }
      }

      // Record in history
      this._addToHistory({
        deliveryId: delivery.deliveryId,
        webhookId: delivery.webhookId,
        event: delivery.event,
        url: delivery.webhookUrl,
        attempt: delivery.attempt,
        statusCode: response.status,
        duration,
        success,
        timestamp: new Date().toISOString()
      });

      if (!success && delivery.attempt < delivery.retryCount) {
        // Schedule retry
        setTimeout(() => {
          this.deliveryQueue.push(delivery);
        }, delivery.retryDelay * delivery.attempt); // Exponential backoff
      }
    } catch (err) {
      const duration = Date.now() - startTime;

      logger.error(`Webhook delivery failed: ${delivery.webhookUrl} - ${err.message}`);

      this._addToHistory({
        deliveryId: delivery.deliveryId,
        webhookId: delivery.webhookId,
        event: delivery.event,
        url: delivery.webhookUrl,
        attempt: delivery.attempt,
        error: err.message,
        duration,
        success: false,
        timestamp: new Date().toISOString()
      });

      // Update failure count
      const webhook = this.webhooks.get(delivery.webhookId);
      if (webhook) {
        webhook.failureCount++;
        if (webhook.failureCount >= 10) {
          webhook.enabled = false;
          logger.warn(`Webhook ${webhook.id} disabled after repeated failures`);
        }
      }

      if (delivery.attempt < delivery.retryCount) {
        setTimeout(() => {
          this.deliveryQueue.push(delivery);
        }, delivery.retryDelay * delivery.attempt);
      }
    }
  }

  _addToHistory(entry) {
    this.deliveryHistory.unshift(entry);
    if (this.deliveryHistory.length > this.maxHistorySize) {
      this.deliveryHistory = this.deliveryHistory.slice(0, this.maxHistorySize);
    }
  }

  _sanitize(webhook) {
    const { secret, ...rest } = webhook;
    return rest;
  }

  shutdown() {
    if (this._processorInterval) {
      clearInterval(this._processorInterval);
    }
    logger.info('WebhookManager shut down');
  }
}

module.exports = WebhookManager;
