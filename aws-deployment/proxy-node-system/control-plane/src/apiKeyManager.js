'use strict';

/**
 * API Key Manager
 * Manages API keys for programmatic access to the control plane
 */

const crypto = require('crypto');
const logger = require('./logger');

class APIKeyManager {
  constructor() {
    this.keys = new Map();          // keyHash -> { metadata }
    this.keysByUser = new Map();    // userId -> [keyHashes]
    this.usageLimits = new Map();   // keyHash -> { rpm, daily, monthly }
    this.usageCounters = new Map(); // keyHash -> { minute: {count, start}, day: {count, start} }

    logger.info('APIKeyManager initialized');
  }

  // ===========================================
  // Key CRUD
  // ===========================================

  generate(userId, options = {}) {
    const prefix = options.prefix || 'pns';
    const rawKey = `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = this._hashKey(rawKey);

    const keyMeta = {
      id: `key-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      userId,
      keyHash,
      keyPrefix: rawKey.substring(0, 8), // Store prefix for identification
      name: options.name || 'API Key',
      permissions: options.permissions || ['read'],
      scopes: options.scopes || ['nodes:read', 'metrics:read'],
      rateLimit: {
        rpm: options.rpm || 60,
        daily: options.daily || 10000,
        monthly: options.monthly || 300000
      },
      expiresAt: options.expiresAt || null,
      lastUsed: null,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      enabled: true
    };

    this.keys.set(keyHash, keyMeta);

    // Track by user
    if (!this.keysByUser.has(userId)) {
      this.keysByUser.set(userId, []);
    }
    this.keysByUser.get(userId).push(keyHash);

    // Initialize rate limits
    this.usageLimits.set(keyHash, keyMeta.rateLimit);
    this.usageCounters.set(keyHash, {
      minute: { count: 0, start: Date.now() },
      day: { count: 0, start: Date.now() },
      month: { count: 0, start: Date.now() }
    });

    logger.info(`API key generated for user ${userId}: ${keyMeta.keyPrefix}...`);

    return {
      key: rawKey,
      ...keyMeta,
      keyHash: undefined // Don't expose hash
    };
  }

  validate(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') {
      return { valid: false, reason: 'missing_key' };
    }

    const keyHash = this._hashKey(rawKey);
    const keyMeta = this.keys.get(keyHash);

    if (!keyMeta) {
      return { valid: false, reason: 'invalid_key' };
    }

    if (!keyMeta.enabled) {
      return { valid: false, reason: 'key_disabled' };
    }

    if (keyMeta.expiresAt && new Date(keyMeta.expiresAt) < new Date()) {
      return { valid: false, reason: 'key_expired' };
    }

    // Check rate limits
    const rateCheck = this._checkRateLimit(keyHash);
    if (!rateCheck.allowed) {
      return { valid: false, reason: rateCheck.reason };
    }

    // Update usage
    keyMeta.lastUsed = new Date().toISOString();
    keyMeta.usageCount++;
    this._incrementUsage(keyHash);

    return {
      valid: true,
      userId: keyMeta.userId,
      permissions: keyMeta.permissions,
      scopes: keyMeta.scopes,
      keyId: keyMeta.id
    };
  }

  hasScope(rawKey, requiredScope) {
    const keyHash = this._hashKey(rawKey);
    const keyMeta = this.keys.get(keyHash);
    if (!keyMeta) return false;

    // Wildcard
    if (keyMeta.scopes.includes('*')) return true;

    // Check exact match
    if (keyMeta.scopes.includes(requiredScope)) return true;

    // Check namespace match (e.g., 'nodes:*' matches 'nodes:read')
    const [namespace] = requiredScope.split(':');
    return keyMeta.scopes.includes(`${namespace}:*`);
  }

  revoke(keyId) {
    for (const [hash, meta] of this.keys) {
      if (meta.id === keyId) {
        meta.enabled = false;
        logger.info(`API key revoked: ${keyId} (${meta.keyPrefix}...)`);
        return true;
      }
    }
    return false;
  }

  delete(keyId) {
    for (const [hash, meta] of this.keys) {
      if (meta.id === keyId) {
        this.keys.delete(hash);
        this.usageCounters.delete(hash);
        this.usageLimits.delete(hash);

        // Remove from user tracking
        const userKeys = this.keysByUser.get(meta.userId);
        if (userKeys) {
          const idx = userKeys.indexOf(hash);
          if (idx !== -1) userKeys.splice(idx, 1);
        }

        logger.info(`API key deleted: ${keyId}`);
        return true;
      }
    }
    return false;
  }

  getKeysByUser(userId) {
    const keyHashes = this.keysByUser.get(userId) || [];
    return keyHashes.map(hash => {
      const meta = this.keys.get(hash);
      if (!meta) return null;
      return {
        id: meta.id,
        name: meta.name,
        keyPrefix: meta.keyPrefix,
        permissions: meta.permissions,
        scopes: meta.scopes,
        enabled: meta.enabled,
        lastUsed: meta.lastUsed,
        usageCount: meta.usageCount,
        expiresAt: meta.expiresAt,
        createdAt: meta.createdAt
      };
    }).filter(Boolean);
  }

  getUsage(keyId) {
    for (const [hash, meta] of this.keys) {
      if (meta.id === keyId) {
        const counters = this.usageCounters.get(hash) || {};
        const limits = this.usageLimits.get(hash) || {};
        return {
          keyId,
          totalUsage: meta.usageCount,
          lastUsed: meta.lastUsed,
          currentMinute: counters.minute?.count || 0,
          currentDay: counters.day?.count || 0,
          currentMonth: counters.month?.count || 0,
          limits
        };
      }
    }
    return null;
  }

  // ===========================================
  // Stats
  // ===========================================

  getStats() {
    const allKeys = Array.from(this.keys.values());
    return {
      totalKeys: allKeys.length,
      activeKeys: allKeys.filter(k => k.enabled).length,
      expiredKeys: allKeys.filter(k => k.expiresAt && new Date(k.expiresAt) < new Date()).length,
      totalUsage: allKeys.reduce((sum, k) => sum + k.usageCount, 0),
      uniqueUsers: this.keysByUser.size
    };
  }

  // ===========================================
  // Private Methods
  // ===========================================

  _hashKey(rawKey) {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  _checkRateLimit(keyHash) {
    const counters = this.usageCounters.get(keyHash);
    const limits = this.usageLimits.get(keyHash);

    if (!counters || !limits) return { allowed: true };

    const now = Date.now();

    // Check per-minute limit
    if (now - counters.minute.start > 60000) {
      counters.minute = { count: 0, start: now };
    }
    if (counters.minute.count >= limits.rpm) {
      return { allowed: false, reason: 'rate_limit_minute' };
    }

    // Check daily limit
    if (now - counters.day.start > 86400000) {
      counters.day = { count: 0, start: now };
    }
    if (counters.day.count >= limits.daily) {
      return { allowed: false, reason: 'rate_limit_daily' };
    }

    return { allowed: true };
  }

  _incrementUsage(keyHash) {
    const counters = this.usageCounters.get(keyHash);
    if (!counters) return;

    counters.minute.count++;
    counters.day.count++;
    counters.month.count++;
  }
}

module.exports = APIKeyManager;
