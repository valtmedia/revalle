const Redis = require('redis');
const config = require('../config');

class RateLimiter {
  constructor() {
    this.redis = Redis.createClient({
      url: config.redis.url
    });
    this.redis.connect().catch(console.error);
  }

  async checkLimit(identifier, limit, window) {
    const key = `ratelimit:${identifier}`;
    const current = await this.redis.incr(key);
    
    if (current === 1) {
      await this.redis.expire(key, window);
    }

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      reset: await this.redis.ttl(key)
    };
  }

  async checkNodeLimit(nodeId, limit = 1000, window = 60) {
    return await this.checkLimit(`node:${nodeId}`, limit, window);
  }

  async checkUserLimit(userId, limit = 100, window = 60) {
    return await this.checkLimit(`user:${userId}`, limit, window);
  }

  async checkIPLimit(ip, limit = 50, window = 60) {
    return await this.checkLimit(`ip:${ip}`, limit, window);
  }

  async checkEndpointLimit(endpoint, limit = 200, window = 60) {
    return await this.checkLimit(`endpoint:${endpoint}`, limit, window);
  }

  async getLimits(identifier) {
    const key = `ratelimit:${identifier}`;
    const current = await this.redis.get(key);
    const ttl = await this.redis.ttl(key);
    
    return {
      current: parseInt(current || 0),
      reset: ttl
    };
  }

  async resetLimit(identifier) {
    await this.redis.del(`ratelimit:${identifier}`);
  }

  async resetAllLimits() {
    const keys = await this.redis.keys('ratelimit:*');
    if (keys.length > 0) {
      await this.redis.del(keys);
    }
  }
}

module.exports = RateLimiter;
