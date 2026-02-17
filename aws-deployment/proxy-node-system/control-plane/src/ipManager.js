'use strict';

/**
 * IP Manager - Whitelist/Blacklist and abuse detection
 * Manages IP-based access control and abuse prevention
 */

const logger = require('./logger');

class IPManager {
  constructor() {
    this.whitelist = new Map();  // ip -> { reason, expiresAt, createdBy }
    this.blacklist = new Map();  // ip -> { reason, expiresAt, createdBy, autoBlocked }
    this.requestCounts = new Map();  // ip -> { count, windowStart }
    this.abuseScores = new Map();   // ip -> { score, lastUpdated, violations }
    this.connectionTracker = new Map(); // ip -> { connections, lastSeen }

    // Configuration
    this.config = {
      // Rate limits
      maxRequestsPerMinute: 300,
      maxRequestsPer10Min: 2000,
      maxConnectionsPerIP: 50,

      // Abuse detection thresholds
      abuseScoreThreshold: 100,
      abuseScoreDecayRate: 5,        // Points per minute
      abuseScoreDecayInterval: 60000, // 1 minute

      // Auto-block settings
      autoBlockDuration: 3600000,  // 1 hour
      autoBlockOnAbuse: true,

      // Request pattern detection
      suspiciousPatterns: [
        /\.onion$/i,
        /torrent/i,
        /mining/i,
        /cryptominer/i,
        /coinhive/i,
        /javascript:.*eval/i
      ],

      // CIDR notation support
      allowCIDR: true
    };

    // Start decay timer
    this._startAbuseDecay();

    logger.info('IPManager initialized');
  }

  // ===========================================
  // Whitelist Management
  // ===========================================

  addToWhitelist(ip, options = {}) {
    const entry = {
      ip,
      reason: options.reason || 'Manual whitelist',
      createdBy: options.createdBy || 'system',
      createdAt: new Date().toISOString(),
      expiresAt: options.expiresAt || null,
      cidr: options.cidr || null
    };

    this.whitelist.set(ip, entry);

    // Remove from blacklist if present
    if (this.blacklist.has(ip)) {
      this.blacklist.delete(ip);
      logger.info(`IP ${ip} removed from blacklist (added to whitelist)`);
    }

    logger.info(`IP ${ip} added to whitelist: ${entry.reason}`);
    return entry;
  }

  removeFromWhitelist(ip) {
    const existed = this.whitelist.delete(ip);
    if (existed) {
      logger.info(`IP ${ip} removed from whitelist`);
    }
    return existed;
  }

  isWhitelisted(ip) {
    if (this.whitelist.has(ip)) {
      const entry = this.whitelist.get(ip);
      if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
        this.whitelist.delete(ip);
        return false;
      }
      return true;
    }

    // Check CIDR ranges
    if (this.config.allowCIDR) {
      for (const [key, entry] of this.whitelist) {
        if (entry.cidr && this._ipInCIDR(ip, entry.cidr)) {
          return true;
        }
      }
    }

    return false;
  }

  getWhitelist() {
    this._cleanExpired(this.whitelist);
    return Array.from(this.whitelist.values());
  }

  // ===========================================
  // Blacklist Management
  // ===========================================

  addToBlacklist(ip, options = {}) {
    const entry = {
      ip,
      reason: options.reason || 'Manual blacklist',
      createdBy: options.createdBy || 'system',
      createdAt: new Date().toISOString(),
      expiresAt: options.expiresAt || null,
      autoBlocked: options.autoBlocked || false,
      cidr: options.cidr || null,
      violations: options.violations || []
    };

    this.blacklist.set(ip, entry);
    logger.warn(`IP ${ip} added to blacklist: ${entry.reason}`);
    return entry;
  }

  removeFromBlacklist(ip) {
    const existed = this.blacklist.delete(ip);
    if (existed) {
      this.abuseScores.delete(ip);
      logger.info(`IP ${ip} removed from blacklist`);
    }
    return existed;
  }

  isBlacklisted(ip) {
    if (this.blacklist.has(ip)) {
      const entry = this.blacklist.get(ip);
      if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
        this.blacklist.delete(ip);
        return false;
      }
      return true;
    }

    // Check CIDR ranges
    if (this.config.allowCIDR) {
      for (const [key, entry] of this.blacklist) {
        if (entry.cidr && this._ipInCIDR(ip, entry.cidr)) {
          return true;
        }
      }
    }

    return false;
  }

  getBlacklist() {
    this._cleanExpired(this.blacklist);
    return Array.from(this.blacklist.values());
  }

  // ===========================================
  // Access Check (combined whitelist/blacklist)
  // ===========================================

  checkAccess(ip) {
    // Whitelisted IPs always pass
    if (this.isWhitelisted(ip)) {
      return { allowed: true, reason: 'whitelisted' };
    }

    // Blacklisted IPs always fail
    if (this.isBlacklisted(ip)) {
      return { allowed: false, reason: 'blacklisted' };
    }

    // Check rate limits
    const rateCheck = this._checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return rateCheck;
    }

    // Check connection limits
    const connCheck = this._checkConnectionLimit(ip);
    if (!connCheck.allowed) {
      return connCheck;
    }

    return { allowed: true, reason: 'passed' };
  }

  // ===========================================
  // Abuse Detection
  // ===========================================

  recordRequest(ip, metadata = {}) {
    const now = Date.now();

    // Update request counter
    if (!this.requestCounts.has(ip)) {
      this.requestCounts.set(ip, { count: 0, windowStart: now, requests: [] });
    }

    const counter = this.requestCounts.get(ip);

    // Reset window if older than 10 minutes
    if (now - counter.windowStart > 600000) {
      counter.count = 0;
      counter.windowStart = now;
      counter.requests = [];
    }

    counter.count++;
    counter.requests.push({ timestamp: now, ...metadata });

    // Keep only last 10 min of requests
    counter.requests = counter.requests.filter(r => now - r.timestamp < 600000);

    // Check for suspicious patterns
    let abusePoints = 0;

    if (metadata.url) {
      for (const pattern of this.config.suspiciousPatterns) {
        if (pattern.test(metadata.url)) {
          abusePoints += 20;
          logger.warn(`Suspicious request pattern from ${ip}: ${metadata.url}`);
          break;
        }
      }
    }

    // Check request rate
    const requestsPerMinute = counter.requests.filter(r => now - r.timestamp < 60000).length;
    if (requestsPerMinute > this.config.maxRequestsPerMinute) {
      abusePoints += 10;
    }

    // Check for repeated failed requests
    if (metadata.statusCode && metadata.statusCode >= 400) {
      const recentErrors = counter.requests.filter(
        r => now - r.timestamp < 60000 && r.statusCode >= 400
      ).length;
      if (recentErrors > 50) {
        abusePoints += 15;
      }
    }

    // Check for rapid-fire requests (< 100ms between requests)
    if (counter.requests.length >= 2) {
      const lastTwo = counter.requests.slice(-2);
      if (lastTwo[1].timestamp - lastTwo[0].timestamp < 100) {
        abusePoints += 5;
      }
    }

    // Update abuse score
    if (abusePoints > 0) {
      this._addAbuseScore(ip, abusePoints, metadata);
    }

    // Update connection tracker
    this.connectionTracker.set(ip, {
      connections: (this.connectionTracker.get(ip)?.connections || 0) + 1,
      lastSeen: now
    });
  }

  getAbuseScore(ip) {
    return this.abuseScores.get(ip) || { score: 0, violations: [] };
  }

  getAbuseReport() {
    const report = [];
    for (const [ip, data] of this.abuseScores) {
      if (data.score > 0) {
        report.push({
          ip,
          score: data.score,
          violations: data.violations.length,
          lastUpdated: data.lastUpdated,
          blocked: this.isBlacklisted(ip)
        });
      }
    }
    return report.sort((a, b) => b.score - a.score);
  }

  // ===========================================
  // Stats & Export
  // ===========================================

  getStats() {
    return {
      whitelistSize: this.whitelist.size,
      blacklistSize: this.blacklist.size,
      trackedIPs: this.requestCounts.size,
      activeConnections: this._getTotalConnections(),
      abuseAlerts: Array.from(this.abuseScores.values()).filter(a => a.score > 50).length,
      autoBlocked: Array.from(this.blacklist.values()).filter(e => e.autoBlocked).length,
      config: { ...this.config, suspiciousPatterns: this.config.suspiciousPatterns.length }
    };
  }

  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    logger.info('IPManager config updated');
    return this.config;
  }

  exportRules() {
    return {
      whitelist: this.getWhitelist(),
      blacklist: this.getBlacklist(),
      exportedAt: new Date().toISOString()
    };
  }

  importRules(rules) {
    let imported = 0;

    if (rules.whitelist) {
      for (const entry of rules.whitelist) {
        this.addToWhitelist(entry.ip, entry);
        imported++;
      }
    }

    if (rules.blacklist) {
      for (const entry of rules.blacklist) {
        this.addToBlacklist(entry.ip, entry);
        imported++;
      }
    }

    logger.info(`Imported ${imported} IP rules`);
    return { imported };
  }

  // ===========================================
  // Private Methods
  // ===========================================

  _checkRateLimit(ip) {
    const counter = this.requestCounts.get(ip);
    if (!counter) return { allowed: true };

    const now = Date.now();
    const requestsPerMinute = counter.requests.filter(r => now - r.timestamp < 60000).length;
    const requestsPer10Min = counter.requests.filter(r => now - r.timestamp < 600000).length;

    if (requestsPerMinute > this.config.maxRequestsPerMinute) {
      return { allowed: false, reason: 'rate_limit_1min', limit: this.config.maxRequestsPerMinute };
    }

    if (requestsPer10Min > this.config.maxRequestsPer10Min) {
      return { allowed: false, reason: 'rate_limit_10min', limit: this.config.maxRequestsPer10Min };
    }

    return { allowed: true };
  }

  _checkConnectionLimit(ip) {
    const conn = this.connectionTracker.get(ip);
    if (!conn) return { allowed: true };

    if (conn.connections > this.config.maxConnectionsPerIP) {
      return { allowed: false, reason: 'connection_limit', limit: this.config.maxConnectionsPerIP };
    }

    return { allowed: true };
  }

  _addAbuseScore(ip, points, metadata) {
    if (!this.abuseScores.has(ip)) {
      this.abuseScores.set(ip, { score: 0, lastUpdated: Date.now(), violations: [] });
    }

    const entry = this.abuseScores.get(ip);
    entry.score += points;
    entry.lastUpdated = Date.now();
    entry.violations.push({
      points,
      timestamp: new Date().toISOString(),
      reason: metadata.url ? `Suspicious URL: ${metadata.url.substring(0, 100)}` : 'Rate/pattern violation'
    });

    // Keep only last 100 violations
    if (entry.violations.length > 100) {
      entry.violations = entry.violations.slice(-100);
    }

    // Auto-block if threshold exceeded
    if (this.config.autoBlockOnAbuse && entry.score >= this.config.abuseScoreThreshold) {
      if (!this.isBlacklisted(ip) && !this.isWhitelisted(ip)) {
        const expiresAt = new Date(Date.now() + this.config.autoBlockDuration).toISOString();
        this.addToBlacklist(ip, {
          reason: `Auto-blocked: abuse score ${entry.score} exceeded threshold ${this.config.abuseScoreThreshold}`,
          autoBlocked: true,
          expiresAt,
          violations: entry.violations.slice(-5)
        });
        logger.warn(`IP ${ip} auto-blocked with abuse score ${entry.score}`);
      }
    }
  }

  _startAbuseDecay() {
    this._decayInterval = setInterval(() => {
      for (const [ip, data] of this.abuseScores) {
        data.score = Math.max(0, data.score - this.config.abuseScoreDecayRate);
        if (data.score === 0 && data.violations.length === 0) {
          this.abuseScores.delete(ip);
        }
      }

      // Clean up old connection tracking
      const now = Date.now();
      for (const [ip, data] of this.connectionTracker) {
        if (now - data.lastSeen > 300000) { // 5 min stale
          this.connectionTracker.delete(ip);
        }
      }
    }, this.config.abuseScoreDecayInterval);
  }

  _cleanExpired(map) {
    const now = new Date();
    for (const [key, entry] of map) {
      if (entry.expiresAt && new Date(entry.expiresAt) < now) {
        map.delete(key);
      }
    }
  }

  _getTotalConnections() {
    let total = 0;
    for (const [, data] of this.connectionTracker) {
      total += data.connections;
    }
    return total;
  }

  _ipInCIDR(ip, cidr) {
    try {
      const [cidrIP, bits] = cidr.split('/');
      const mask = -1 << (32 - parseInt(bits));
      const ipNum = this._ipToNumber(ip);
      const cidrNum = this._ipToNumber(cidrIP);
      return (ipNum & mask) === (cidrNum & mask);
    } catch {
      return false;
    }
  }

  _ipToNumber(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }

  shutdown() {
    if (this._decayInterval) {
      clearInterval(this._decayInterval);
    }
    logger.info('IPManager shut down');
  }
}

module.exports = IPManager;
