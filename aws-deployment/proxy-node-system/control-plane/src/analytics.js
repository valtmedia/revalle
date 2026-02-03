const Redis = require('redis');
const config = require('../config');

class Analytics {
  constructor() {
    this.redis = Redis.createClient({
      url: config.redis.url
    });
    this.redis.connect().catch(console.error);
  }

  async recordEvent(eventType, data) {
    const event = {
      type: eventType,
      data,
      timestamp: Date.now(),
      date: new Date().toISOString()
    };

    const key = `analytics:${eventType}:${Date.now()}`;
    await this.redis.setEx(key, 86400 * 30, JSON.stringify(event)); // 30 days

    // Update counters
    await this.redis.incr(`stats:events:${eventType}`);
    await this.redis.incr(`stats:events:total`);

    // Time-series data
    const hour = new Date().toISOString().slice(0, 13);
    await this.redis.incr(`stats:hourly:${hour}:${eventType}`);
  }

  async getStats(timeRange = '24h') {
    const now = Date.now();
    let startTime;

    switch (timeRange) {
      case '1h':
        startTime = now - 3600000;
        break;
      case '24h':
        startTime = now - 86400000;
        break;
      case '7d':
        startTime = now - 604800000;
        break;
      case '30d':
        startTime = now - 2592000000;
        break;
      default:
        startTime = now - 86400000;
    }

    const stats = {
      totalRequests: await this.redis.get('stats:events:total') || 0,
      nodeRegistrations: await this.redis.get('stats:events:node:registered') || 0,
      nodeHeartbeats: await this.redis.get('stats:events:node:heartbeat') || 0,
      proxyRequests: await this.redis.get('stats:events:proxy:request') || 0,
      errors: await this.redis.get('stats:events:error') || 0,
      timeRange
    };

    return stats;
  }

  async getHourlyStats(hours = 24) {
    const stats = [];
    const now = new Date();

    for (let i = hours - 1; i >= 0; i--) {
      const hour = new Date(now.getTime() - i * 3600000).toISOString().slice(0, 13);
      const requests = await this.redis.get(`stats:hourly:${hour}:proxy:request`) || 0;
      const errors = await this.redis.get(`stats:hourly:${hour}:error`) || 0;
      
      stats.push({
        hour,
        requests: parseInt(requests),
        errors: parseInt(errors)
      });
    }

    return stats;
  }

  async getTopNodes(limit = 10) {
    const nodes = await this.redis.keys('stats:node:*:requests');
    const nodeStats = [];

    for (const key of nodes) {
      const nodeId = key.replace('stats:node:', '').replace(':requests', '');
      const requests = await this.redis.get(key) || 0;
      const bandwidth = await this.redis.get(`stats:node:${nodeId}:bandwidth`) || 0;
      
      nodeStats.push({
        nodeId,
        requests: parseInt(requests),
        bandwidth: parseInt(bandwidth)
      });
    }

    return nodeStats
      .sort((a, b) => b.requests - a.requests)
      .slice(0, limit);
  }

  async getGeographicStats() {
    const regions = await this.redis.keys('stats:region:*');
    const regionStats = [];

    for (const key of regions) {
      const region = key.replace('stats:region:', '');
      const requests = await this.redis.get(key) || 0;
      
      regionStats.push({
        region,
        requests: parseInt(requests)
      });
    }

    return regionStats.sort((a, b) => b.requests - a.requests);
  }

  async recordProxyRequest(nodeId, metrics) {
    await this.recordEvent('proxy:request', { nodeId, ...metrics });
    
    // Update node-specific stats
    await this.redis.incr(`stats:node:${nodeId}:requests`);
    await this.redis.incrBy(`stats:node:${nodeId}:bandwidth`, metrics.bytes || 0);
    
    // Update regional stats
    if (metrics.region) {
      await this.redis.incr(`stats:region:${metrics.region}`);
    }
  }

  async recordError(errorType, details) {
    await this.recordEvent('error', { type: errorType, ...details });
    await this.redis.incr(`stats:errors:${errorType}`);
  }

  async getErrorStats() {
    const errorTypes = await this.redis.keys('stats:errors:*');
    const errors = [];

    for (const key of errorTypes) {
      const type = key.replace('stats:errors:', '');
      const count = await this.redis.get(key) || 0;
      errors.push({ type, count: parseInt(count) });
    }

    return errors.sort((a, b) => b.count - a.count);
  }

  async exportData(format = 'json') {
    const data = {
      timestamp: new Date().toISOString(),
      stats: await this.getStats('30d'),
      hourly: await this.getHourlyStats(168), // 7 days
      topNodes: await this.getTopNodes(20),
      geographic: await this.getGeographicStats(),
      errors: await this.getErrorStats()
    };

    if (format === 'csv') {
      return this.toCSV(data);
    }

    return JSON.stringify(data, null, 2);
  }

  toCSV(data) {
    // Simple CSV conversion
    let csv = 'Type,Value\n';
    csv += `Total Requests,${data.stats.totalRequests}\n`;
    csv += `Errors,${data.stats.errors}\n`;
    return csv;
  }
}

module.exports = Analytics;
