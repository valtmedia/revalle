const { auditLogger } = require('./logger');
const Database = require('./database');

/**
 * Audit Log System
 * Records all security-relevant events for compliance and forensics
 * Immutable, timestamped, with integrity verification
 */
class AuditLog {
  constructor(options = {}) {
    this.db = options.database || new Database({ dataDir: options.dataDir });
    this.collection = 'audit_logs';
    this.maxRetentionDays = options.maxRetentionDays || 365;
    this.initialized = false;
    this.eventQueue = [];
    this.flushInterval = null;
    this.integrityChain = null;
  }

  /**
   * Initialize the audit log system
   */
  async initialize() {
    if (!this.db.initialized) {
      await this.db.initialize();
    }
    
    // Create indexes
    await this.db.createIndex(this.collection, 'userId');
    await this.db.createIndex(this.collection, 'action');
    await this.db.createIndex(this.collection, 'timestamp');
    await this.db.createIndex(this.collection, 'resourceType');
    
    // Get last entry hash for integrity chain
    const lastEntry = await this.db.find(this.collection, {}, {
      sort: { timestamp: -1 },
      limit: 1
    });
    this.integrityChain = lastEntry.length > 0 ? lastEntry[0].hash : null;
    
    // Start periodic flush
    this.flushInterval = setInterval(() => this._flushQueue(), 5000);
    
    this.initialized = true;
  }

  /**
   * Record an audit event
   */
  async log(event) {
    const entry = {
      _id: this._generateEntryId(),
      timestamp: new Date().toISOString(),
      action: event.action,
      category: event.category || this._categorizeAction(event.action),
      userId: event.userId || 'system',
      username: event.username || null,
      userRole: event.userRole || null,
      ip: event.ip || null,
      userAgent: event.userAgent || null,
      resourceType: event.resourceType || null,
      resourceId: event.resourceId || null,
      details: event.details || {},
      result: event.result || 'success',
      severity: event.severity || 'info',
      // Integrity
      previousHash: this.integrityChain,
      hash: null
    };
    
    // Generate integrity hash
    entry.hash = this._generateHash(entry);
    this.integrityChain = entry.hash;
    
    // Queue for batch write
    this.eventQueue.push(entry);
    
    // Also log to file
    auditLogger.info(event.action, entry);
    
    // Flush immediately for critical events
    if (entry.severity === 'critical') {
      await this._flushQueue();
    }
    
    return entry;
  }

  /**
   * Log authentication events
   */
  async logAuth(action, details) {
    return this.log({
      action: `auth:${action}`,
      category: 'authentication',
      severity: action === 'login_failed' ? 'warning' : 'info',
      ...details
    });
  }

  /**
   * Log data access events
   */
  async logAccess(action, details) {
    return this.log({
      action: `access:${action}`,
      category: 'data_access',
      ...details
    });
  }

  /**
   * Log configuration changes
   */
  async logConfigChange(action, details) {
    return this.log({
      action: `config:${action}`,
      category: 'configuration',
      severity: 'warning',
      ...details
    });
  }

  /**
   * Log node management events
   */
  async logNodeEvent(action, details) {
    return this.log({
      action: `node:${action}`,
      category: 'node_management',
      ...details
    });
  }

  /**
   * Log security events
   */
  async logSecurity(action, details) {
    return this.log({
      action: `security:${action}`,
      category: 'security',
      severity: details.severity || 'warning',
      ...details
    });
  }

  /**
   * Query audit logs
   */
  async query(filters = {}, options = {}) {
    const query = {};
    
    if (filters.userId) query.userId = filters.userId;
    if (filters.action) query.action = { $regex: filters.action };
    if (filters.category) query.category = filters.category;
    if (filters.severity) query.severity = filters.severity;
    if (filters.resourceType) query.resourceType = filters.resourceType;
    if (filters.resourceId) query.resourceId = filters.resourceId;
    if (filters.result) query.result = filters.result;
    
    if (filters.startTime || filters.endTime) {
      query.timestamp = {};
      if (filters.startTime) query.timestamp.$gte = filters.startTime;
      if (filters.endTime) query.timestamp.$lte = filters.endTime;
    }
    
    const results = await this.db.find(this.collection, query, {
      sort: { timestamp: -1 },
      skip: options.skip || 0,
      limit: options.limit || 100
    });
    
    const total = await this.db.count(this.collection, query);
    
    return {
      entries: results,
      total,
      page: Math.floor((options.skip || 0) / (options.limit || 100)) + 1,
      pages: Math.ceil(total / (options.limit || 100))
    };
  }

  /**
   * Get audit summary
   */
  async getSummary(timeRange = '24h') {
    const startTime = this._getStartTime(timeRange);
    
    const allEntries = await this.db.find(this.collection, {
      timestamp: { $gte: startTime }
    });
    
    const summary = {
      timeRange,
      totalEvents: allEntries.length,
      byCategory: {},
      bySeverity: {},
      byResult: {},
      byUser: {},
      topActions: {},
      criticalEvents: 0,
      failedActions: 0
    };
    
    for (const entry of allEntries) {
      // By category
      summary.byCategory[entry.category] = (summary.byCategory[entry.category] || 0) + 1;
      
      // By severity
      summary.bySeverity[entry.severity] = (summary.bySeverity[entry.severity] || 0) + 1;
      
      // By result
      summary.byResult[entry.result] = (summary.byResult[entry.result] || 0) + 1;
      
      // By user
      if (entry.userId !== 'system') {
        summary.byUser[entry.userId] = (summary.byUser[entry.userId] || 0) + 1;
      }
      
      // Top actions
      summary.topActions[entry.action] = (summary.topActions[entry.action] || 0) + 1;
      
      // Counters
      if (entry.severity === 'critical') summary.criticalEvents++;
      if (entry.result === 'failure') summary.failedActions++;
    }
    
    // Sort top actions
    summary.topActions = Object.entries(summary.topActions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});
    
    return summary;
  }

  /**
   * Verify integrity of audit log chain
   */
  async verifyIntegrity(options = {}) {
    const entries = await this.db.find(this.collection, {}, {
      sort: { timestamp: 1 },
      limit: options.limit || 10000
    });
    
    let previousHash = null;
    let valid = true;
    let checked = 0;
    const issues = [];
    
    for (const entry of entries) {
      checked++;
      
      // Verify chain
      if (entry.previousHash !== previousHash) {
        valid = false;
        issues.push({
          entryId: entry._id,
          timestamp: entry.timestamp,
          issue: 'Chain break detected',
          expected: previousHash,
          actual: entry.previousHash
        });
      }
      
      // Verify hash
      const expectedHash = this._generateHash({ ...entry, hash: null });
      if (entry.hash !== expectedHash) {
        valid = false;
        issues.push({
          entryId: entry._id,
          timestamp: entry.timestamp,
          issue: 'Hash mismatch - entry may have been tampered with'
        });
      }
      
      previousHash = entry.hash;
    }
    
    return {
      valid,
      entriesChecked: checked,
      issues,
      lastHash: previousHash
    };
  }

  /**
   * Export audit logs
   */
  async export(filters = {}, format = 'json') {
    const results = await this.query(filters, { limit: 100000 });
    
    if (format === 'csv') {
      const headers = ['timestamp', 'action', 'category', 'userId', 'severity', 'result', 'ip', 'resourceType', 'resourceId'];
      let csv = headers.join(',') + '\n';
      
      for (const entry of results.entries) {
        csv += headers.map(h => {
          const val = entry[h] || '';
          return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
        }).join(',') + '\n';
      }
      
      return csv;
    }
    
    return JSON.stringify(results.entries, null, 2);
  }

  /**
   * Cleanup old audit entries
   */
  async cleanup() {
    const cutoffDate = new Date(Date.now() - this.maxRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    
    const result = await this.db.deleteMany(this.collection, {
      timestamp: { $lt: cutoffDate }
    });
    
    if (result.deleted > 0) {
      auditLogger.info('Audit log cleanup', { 
        entriesRemoved: result.deleted, 
        cutoffDate 
      });
    }
    
    return result;
  }

  /**
   * Get statistics
   */
  async getStats() {
    const total = await this.db.count(this.collection);
    
    return {
      totalEntries: total,
      queuedEntries: this.eventQueue.length,
      maxRetentionDays: this.maxRetentionDays,
      integrityChainLength: total,
      initialized: this.initialized
    };
  }

  /**
   * Shutdown
   */
  async shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this._flushQueue();
  }

  // Private methods

  async _flushQueue() {
    if (this.eventQueue.length === 0) return;
    
    const batch = this.eventQueue.splice(0, this.eventQueue.length);
    
    try {
      await this.db.insertMany(this.collection, batch);
    } catch (error) {
      // Put failed entries back
      this.eventQueue.unshift(...batch);
      auditLogger.error('Failed to flush audit queue', { error: error.message, count: batch.length });
    }
  }

  _generateEntryId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 10);
    return `audit-${ts}-${rand}`;
  }

  _generateHash(entry) {
    const crypto = require('crypto');
    const data = JSON.stringify({
      timestamp: entry.timestamp,
      action: entry.action,
      userId: entry.userId,
      details: entry.details,
      previousHash: entry.previousHash
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  _categorizeAction(action) {
    if (action.startsWith('auth:')) return 'authentication';
    if (action.startsWith('access:')) return 'data_access';
    if (action.startsWith('config:')) return 'configuration';
    if (action.startsWith('node:')) return 'node_management';
    if (action.startsWith('security:')) return 'security';
    if (action.startsWith('user:')) return 'user_management';
    if (action.startsWith('backup:')) return 'backup';
    return 'general';
  }

  _getStartTime(timeRange) {
    const now = Date.now();
    const ranges = {
      '1h': 3600000,
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000,
      '90d': 7776000000
    };
    return new Date(now - (ranges[timeRange] || ranges['24h'])).toISOString();
  }
}

module.exports = AuditLog;
