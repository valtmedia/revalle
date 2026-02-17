'use strict';

/**
 * Prometheus-compatible metrics exporter
 * Provides both a custom implementation and prom-client wrappers
 * for maximum compatibility with Prometheus scraping
 */

let client;
try {
  client = require('prom-client');
} catch {
  client = null;
}

// ===========================================
// prom-client based metrics (preferred)
// ===========================================

if (client) {
  const register = new client.Registry();
  client.collectDefaultMetrics({ register, prefix: 'proxy_' });

  // HTTP request metrics
  const httpRequestCounter = new client.Counter({
    name: 'proxy_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register]
  });

  const httpRequestDuration = new client.Histogram({
    name: 'proxy_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register]
  });

  // Proxy node metrics
  const proxyNodesGauge = new client.Gauge({
    name: 'proxy_nodes_total',
    help: 'Total proxy nodes by status',
    labelNames: ['status'],
    registers: [register]
  });

  const proxyActiveConnections = new client.Gauge({
    name: 'proxy_active_connections',
    help: 'Active proxy connections per node',
    labelNames: ['node_id'],
    registers: [register]
  });

  const proxyErrorsCounter = new client.Counter({
    name: 'proxy_errors_total',
    help: 'Total proxy errors',
    labelNames: ['type', 'node_id'],
    registers: [register]
  });

  const proxyBytesTransferred = new client.Counter({
    name: 'proxy_bytes_transferred_total',
    help: 'Total bytes transferred through proxy',
    labelNames: ['node_id'],
    registers: [register]
  });

  const proxyRequestsCounter = new client.Counter({
    name: 'proxy_requests_total',
    help: 'Total proxy requests processed',
    labelNames: ['region', 'status'],
    registers: [register]
  });

  const proxyLatencyHistogram = new client.Histogram({
    name: 'proxy_request_latency_seconds',
    help: 'Proxy request latency',
    labelNames: ['region'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register]
  });

  // Node-specific metrics
  const nodeCpuGauge = new client.Gauge({
    name: 'proxy_node_cpu_usage',
    help: 'Node CPU usage percentage',
    labelNames: ['node_id'],
    registers: [register]
  });

  const nodeMemoryGauge = new client.Gauge({
    name: 'proxy_node_memory_usage',
    help: 'Node memory usage percentage',
    labelNames: ['node_id'],
    registers: [register]
  });

  const nodeDiskGauge = new client.Gauge({
    name: 'proxy_node_disk_usage',
    help: 'Node disk usage percentage',
    labelNames: ['node_id'],
    registers: [register]
  });

  const nodeLoadGauge = new client.Gauge({
    name: 'proxy_node_load',
    help: 'Node load score',
    labelNames: ['node_id', 'region'],
    registers: [register]
  });

  // Cache metrics
  const cacheHitRatioGauge = new client.Gauge({
    name: 'proxy_cache_hit_ratio',
    help: 'Cache hit ratio per node',
    labelNames: ['node_id'],
    registers: [register]
  });

  // Healthy nodes gauge
  const healthyNodesGauge = new client.Gauge({
    name: 'proxy_healthy_nodes_total',
    help: 'Total number of healthy proxy nodes',
    registers: [register]
  });

  // Alert metrics
  const alertsGauge = new client.Gauge({
    name: 'proxy_active_alerts',
    help: 'Number of active alerts',
    labelNames: ['severity'],
    registers: [register]
  });

  // User metrics
  const usersGauge = new client.Gauge({
    name: 'proxy_users_total',
    help: 'Total users by role',
    labelNames: ['role'],
    registers: [register]
  });

  module.exports = {
    register,
    httpRequestCounter,
    httpRequestDuration,
    proxyNodesGauge,
    proxyActiveConnections,
    proxyErrorsCounter,
    proxyBytesTransferred,
    proxyRequestsCounter,
    proxyLatencyHistogram,
    nodeCpuGauge,
    nodeMemoryGauge,
    nodeDiskGauge,
    nodeLoadGauge,
    cacheHitRatioGauge,
    healthyNodesGauge,
    alertsGauge,
    usersGauge
  };
} else {
  // ===========================================
  // Fallback: Custom implementation
  // ===========================================

  class FallbackMetric {
    constructor() { this.data = new Map(); }
    inc(labels = {}, val = 1) {}
    set(labels = {}, val = 0) {}
    observe(labels = {}, val = 0) {}
  }

  const fallbackRegister = {
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    async metrics() {
      return '# No prom-client installed. Install prom-client for full metrics support.\n';
    }
  };

  module.exports = {
    register: fallbackRegister,
    httpRequestCounter: new FallbackMetric(),
    httpRequestDuration: new FallbackMetric(),
    proxyNodesGauge: new FallbackMetric(),
    proxyActiveConnections: new FallbackMetric(),
    proxyErrorsCounter: new FallbackMetric(),
    proxyBytesTransferred: new FallbackMetric(),
    proxyRequestsCounter: new FallbackMetric(),
    proxyLatencyHistogram: new FallbackMetric(),
    nodeCpuGauge: new FallbackMetric(),
    nodeMemoryGauge: new FallbackMetric(),
    nodeDiskGauge: new FallbackMetric(),
    nodeLoadGauge: new FallbackMetric(),
    cacheHitRatioGauge: new FallbackMetric(),
    healthyNodesGauge: new FallbackMetric(),
    alertsGauge: new FallbackMetric(),
    usersGauge: new FallbackMetric()
  };
}
