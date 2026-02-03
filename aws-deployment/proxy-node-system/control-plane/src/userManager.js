const Redis = require('redis');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../config');

class UserManager {
  constructor() {
    this.redis = Redis.createClient({
      url: config.redis.url
    });
    this.redis.connect().catch(console.error);
  }

  async createUser(userData) {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    
    const user = {
      id: userData.id || this.generateUserId(),
      username: userData.username,
      email: userData.email,
      password: hashedPassword,
      role: userData.role || 'user',
      permissions: userData.permissions || [],
      quota: userData.quota || {
        requests: 10000,
        bandwidth: 10737418240, // 10GB
        period: 'monthly'
      },
      usage: {
        requests: 0,
        bandwidth: 0,
        resetAt: this.getNextResetDate(userData.quota?.period || 'monthly')
      },
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.redis.set(`user:${user.id}`, JSON.stringify(user));
    await this.redis.set(`user:username:${user.username}`, user.id);
    if (user.email) {
      await this.redis.set(`user:email:${user.email}`, user.id);
    }

    return { ...user, password: undefined };
  }

  async getUser(userId) {
    const data = await this.redis.get(`user:${userId}`);
    return data ? JSON.parse(data) : null;
  }

  async getUserByUsername(username) {
    const userId = await this.redis.get(`user:username:${username}`);
    if (!userId) return null;
    return await this.getUser(userId);
  }

  async authenticate(username, password) {
    const user = await this.getUserByUsername(username);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new Error('User account is not active');
    }

    // Check quota
    if (this.isQuotaExceeded(user)) {
      throw new Error('Quota exceeded');
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    return { token, user: { ...user, password: undefined } };
  }

  async updateUser(userId, updates) {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    Object.assign(user, updates, {
      updatedAt: new Date().toISOString()
    });

    await this.redis.set(`user:${userId}`, JSON.stringify(user));
    return { ...user, password: undefined };
  }

  async recordUsage(userId, metrics) {
    const user = await this.getUser(userId);
    if (!user) return;

    user.usage.requests += metrics.requests || 0;
    user.usage.bandwidth += metrics.bandwidth || 0;

    await this.redis.set(`user:${userId}`, JSON.stringify(user));
  }

  isQuotaExceeded(user) {
    const quota = user.quota;
    const usage = user.usage;

    // Check if reset needed
    if (new Date() > new Date(usage.resetAt)) {
      usage.requests = 0;
      usage.bandwidth = 0;
      usage.resetAt = this.getNextResetDate(quota.period);
    }

    return usage.requests >= quota.requests || usage.bandwidth >= quota.bandwidth;
  }

  getNextResetDate(period) {
    const date = new Date();
    if (period === 'daily') {
      date.setDate(date.getDate() + 1);
    } else if (period === 'weekly') {
      date.setDate(date.getDate() + 7);
    } else if (period === 'monthly') {
      date.setMonth(date.getMonth() + 1);
    }
    return date.toISOString();
  }

  generateUserId() {
    return `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async getAllUsers() {
    const keys = await this.redis.keys('user:*');
    const userIds = keys
      .filter(k => !k.includes(':username:') && !k.includes(':email:'))
      .map(k => k.replace('user:', ''));
    
    const users = [];
    for (const id of userIds) {
      const user = await this.getUser(id);
      if (user) {
        users.push({ ...user, password: undefined });
      }
    }
    return users;
  }

  async deleteUser(userId) {
    const user = await this.getUser(userId);
    if (user) {
      await this.redis.del(`user:${userId}`);
      await this.redis.del(`user:username:${user.username}`);
      if (user.email) {
        await this.redis.del(`user:email:${user.email}`);
      }
    }
  }
}

module.exports = UserManager;
