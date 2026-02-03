const Redis = require('redis');
const config = require('../config');

class MetricsCollector {
  constructor() {
    this.redis = Redis.createClient({
      url: config.redis.url
    });
    this.redis.connect().catch(console.error);
  }

  async recordRequest(nodeId, metrics) {
    const timestamp = Date.now();
    const key = `metrics:${nodeId}:${timestamp}`;
    
    await this.redis.setEx(key, 3600, JSON.stringify({
      nodeId,
      timestamp,
      ...metrics
    }));

    // Update aggregates
    await this.redis.incr(`stats:${nodeId}:requests`);
    await this.redis.incr('stats:global:requests');
    
    if (metrics.bytes) {
      await this.redis.incrBy(`stats:${nodeId}:bytes`, metrics.bytes);
      await this.redis.incrBy('stats:global:bytes', metrics.bytes);
    }

    if (metrics.latency) {
      await this.redis.lPush(`stats:${nodeId}:latencies`, metrics.latency);
      await this.redis.lTrim(`stats:${nodeId}:latencies`, 0, 999); // Keep last 1000
    }
  }

  async getMetrics(options = {}) {
    const { nodeId, startTime, endTime, limit = 100 } = options;
    
    if (nodeId) {
      return await this.getNodeMetrics(nodeId, options);
    }

    // Global metrics
    const totalRequests = await this.redis.get('stats:global:requests') || 0;
    const totalBytes = await this.redis.get('stats:global:bytes') || 0;

    return {
      totalRequests: parseInt(totalRequests),
      totalBytes: parseInt(totalBytes),
      averageLatency: await this.getAverageLatency(),
      timestamp: new Date().toISOString()
    };
  }

  async getNodeMetrics(nodeId, options = {}) {
    const totalRequests = await this.redis.get(`stats:${nodeId}:requests`) || 0;
    const totalBytes = await this.redis.get(`stats:${nodeId}:bytes`) || 0;
    const latencies = await this.redis.lRange(`stats:${nodeId}:latencies`, 0, -1);

    const latencyValues = latencies.map(l => parseFloat(l)).filter(l => !isNaN(l));
    const averageLatency = latencyValues.length > 0
      ? latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
      : 0;

    return {
      nodeId,
      totalRequests: parseInt(totalRequests),
      totalBytes: parseInt(totalBytes),
      averageLatency: averageLatency.toFixed(2),
      minLatency: latencyValues.length > 0 ? Math.min(...latencyValues).toFixed(2) : 0,
      maxLatency: latencyValues.length > 0 ? Math.max(...latencyValues).toFixed(2) : 0,
      timestamp: new Date().toISOString()
    };
  }

  async getTotalRequests() {
    const count = await this.redis.get('stats:global:requests');
    return parseInt(count || 0);
  }

  async getAverageLatency() {
    // This would need to aggregate across all nodes
    // Simplified version
    return 0;
  }

  async getBandwidthUsed() {
    const bytes = await this.redis.get('stats:global:bytes');
    return parseInt(bytes || 0);
  }

  async collectMetrics() {
    // Periodic collection and aggregation
    // Could send to time-series database, etc.
    console.log('Collecting metrics...');
  }
}

module.exports = MetricsCollector;
