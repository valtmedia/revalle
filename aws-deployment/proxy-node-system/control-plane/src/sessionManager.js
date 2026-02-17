const crypto = require('crypto');
const Redis = require('redis');
const config = require('../config');
const { logger, auditLogger } = require('./logger');

/**
 * Session Manager
 * Manages user sessions, session tokens, and session storage
 * Supports Redis-backed sessions with fallback to in-memory
 */
class SessionManager {
  constructor(options = {}) {
    this.sessions = new Map(); // In-memory fallback
    this.sessionTTL = options.sessionTTL || 24 * 60 * 60; // 24 hours in seconds
    this.maxSessionsPerUser = options.maxSessionsPerUser || 5;
    this.sessionPrefix = 'session:';
    this.userSessionPrefix = 'user-sessions:';
    this.useRedis = false;
    
    // Try to connect to Redis
    try {
      this.redis = Redis.createClient({ url: config.redis.url });
      this.redis.connect().then(() => {
        this.useRedis = true;
        logger.info('Session manager connected to Redis');
      }).catch(err => {
        logger.warn('Session manager falling back to in-memory storage', { error: err.message });
      });
    } catch {
      logger.warn('Redis not available, using in-memory sessions');
    }
  }

  /**
   * Create a new session
   */
  async createSession(userId, metadata = {}) {
    const sessionId = this._generateSessionId();
    const now = Date.now();
    
    const session = {
      id: sessionId,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.sessionTTL * 1000).toISOString(),
      lastActivity: new Date(now).toISOString(),
      ip: metadata.ip || null,
      userAgent: metadata.userAgent || null,
      device: this._parseDevice(metadata.userAgent),
      location: metadata.location || null,
      data: metadata.data || {},
      active: true
    };
    
    // Enforce max sessions per user
    await this._enforceMaxSessions(userId);
    
    // Store session
    if (this.useRedis) {
      await this.redis.setEx(
        `${this.sessionPrefix}${sessionId}`,
        this.sessionTTL,
        JSON.stringify(session)
      );
      await this.redis.sAdd(`${this.userSessionPrefix}${userId}`, sessionId);
    } else {
      this.sessions.set(sessionId, session);
    }
    
    auditLogger.info('Session created', {
      sessionId,
      userId,
      ip: metadata.ip,
      device: session.device
    });
    
    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId) {
    let session;
    
    if (this.useRedis) {
      const data = await this.redis.get(`${this.sessionPrefix}${sessionId}`);
      session = data ? JSON.parse(data) : null;
    } else {
      session = this.sessions.get(sessionId) || null;
    }
    
    if (!session) return null;
    
    // Check expiration
    if (new Date(session.expiresAt) < new Date()) {
      await this.destroySession(sessionId);
      return null;
    }
    
    return session;
  }

  /**
   * Validate and refresh a session
   */
  async validateSession(sessionId) {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      return { valid: false, reason: 'Session not found or expired' };
    }
    
    if (!session.active) {
      return { valid: false, reason: 'Session is inactive' };
    }
    
    // Update last activity
    session.lastActivity = new Date().toISOString();
    
    // Extend session if within renewal window (last 25% of TTL)
    const totalTTL = new Date(session.expiresAt) - new Date(session.createdAt);
    const remaining = new Date(session.expiresAt) - Date.now();
    
    if (remaining < totalTTL * 0.25) {
      session.expiresAt = new Date(Date.now() + this.sessionTTL * 1000).toISOString();
    }
    
    // Save updated session
    if (this.useRedis) {
      const ttl = Math.ceil((new Date(session.expiresAt) - Date.now()) / 1000);
      await this.redis.setEx(
        `${this.sessionPrefix}${sessionId}`,
        ttl,
        JSON.stringify(session)
      );
    } else {
      this.sessions.set(sessionId, session);
    }
    
    return { valid: true, session };
  }

  /**
   * Update session data
   */
  async updateSessionData(sessionId, data) {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    session.data = { ...session.data, ...data };
    session.lastActivity = new Date().toISOString();
    
    if (this.useRedis) {
      const ttl = Math.ceil((new Date(session.expiresAt) - Date.now()) / 1000);
      await this.redis.setEx(
        `${this.sessionPrefix}${sessionId}`,
        ttl,
        JSON.stringify(session)
      );
    } else {
      this.sessions.set(sessionId, session);
    }
    
    return session;
  }

  /**
   * Destroy a session
   */
  async destroySession(sessionId) {
    const session = await this.getSession(sessionId);
    
    if (this.useRedis) {
      await this.redis.del(`${this.sessionPrefix}${sessionId}`);
      if (session) {
        await this.redis.sRem(`${this.userSessionPrefix}${session.userId}`, sessionId);
      }
    } else {
      this.sessions.delete(sessionId);
    }
    
    if (session) {
      auditLogger.info('Session destroyed', {
        sessionId,
        userId: session.userId
      });
    }
    
    return true;
  }

  /**
   * Destroy all sessions for a user
   */
  async destroyUserSessions(userId) {
    const sessions = await this.getUserSessions(userId);
    
    for (const session of sessions) {
      await this.destroySession(session.id);
    }
    
    auditLogger.info('All user sessions destroyed', {
      userId,
      count: sessions.length
    });
    
    return sessions.length;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId) {
    if (this.useRedis) {
      const sessionIds = await this.redis.sMembers(`${this.userSessionPrefix}${userId}`);
      const sessions = [];
      
      for (const id of sessionIds) {
        const session = await this.getSession(id);
        if (session) {
          sessions.push(session);
        }
      }
      
      return sessions;
    } else {
      return [...this.sessions.values()].filter(s => s.userId === userId);
    }
  }

  /**
   * Get all active sessions
   */
  async getActiveSessions() {
    if (this.useRedis) {
      const keys = await this.redis.keys(`${this.sessionPrefix}*`);
      const sessions = [];
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const session = JSON.parse(data);
          if (session.active) {
            sessions.push({
              ...session,
              // Don't expose session data in listing
              data: undefined
            });
          }
        }
      }
      
      return sessions;
    } else {
      return [...this.sessions.values()]
        .filter(s => s.active)
        .map(s => ({ ...s, data: undefined }));
    }
  }

  /**
   * Get session statistics
   */
  async getStats() {
    const sessions = await this.getActiveSessions();
    
    const byDevice = {};
    const byUser = {};
    
    for (const session of sessions) {
      const device = session.device || 'unknown';
      byDevice[device] = (byDevice[device] || 0) + 1;
      byUser[session.userId] = (byUser[session.userId] || 0) + 1;
    }
    
    return {
      total: sessions.length,
      storage: this.useRedis ? 'redis' : 'memory',
      byDevice,
      uniqueUsers: Object.keys(byUser).length,
      maxSessionsPerUser: this.maxSessionsPerUser,
      sessionTTL: this.sessionTTL
    };
  }

  /**
   * Cleanup expired sessions (for in-memory mode)
   */
  async cleanup() {
    if (this.useRedis) {
      // Redis handles TTL-based expiration automatically
      return 0;
    }
    
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt) < new Date(now)) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info('Cleaned up expired sessions', { count: cleaned });
    }
    
    return cleaned;
  }

  // Private methods

  async _enforceMaxSessions(userId) {
    const sessions = await this.getUserSessions(userId);
    
    if (sessions.length >= this.maxSessionsPerUser) {
      // Sort by last activity, destroy oldest
      sessions.sort((a, b) => new Date(a.lastActivity) - new Date(b.lastActivity));
      
      const toDestroy = sessions.slice(0, sessions.length - this.maxSessionsPerUser + 1);
      for (const session of toDestroy) {
        await this.destroySession(session.id);
        logger.info('Evicted old session', {
          sessionId: session.id,
          userId,
          reason: 'max_sessions_exceeded'
        });
      }
    }
  }

  _generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  _parseDevice(userAgent) {
    if (!userAgent) return 'unknown';
    
    if (/mobile|android|iphone|ipad/i.test(userAgent)) return 'mobile';
    if (/curl|wget|axios|node-fetch|python/i.test(userAgent)) return 'api-client';
    if (/chrome|firefox|safari|edge/i.test(userAgent)) return 'browser';
    
    return 'other';
  }
}

module.exports = SessionManager;
