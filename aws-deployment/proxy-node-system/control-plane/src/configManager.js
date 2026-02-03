const Redis = require('redis');
const config = require('../config');

class ConfigManager {
  constructor() {
    this.redis = Redis.createClient({
      url: config.redis.url
    });
    this.redis.connect().catch(console.error);
  }

  async getConfig(key) {
    const data = await this.redis.get(`config:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async setConfig(key, value) {
    await this.redis.set(`config:${key}`, JSON.stringify({
      value,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system'
    }));
  }

  async getSystemConfig() {
    return {
      loadBalancing: {
        strategy: await this.getConfig('load_balancing_strategy') || 'round-robin',
        enabled: await this.getConfig('load_balancing_enabled') !== false
      },
      rateLimiting: {
        enabled: await this.getConfig('rate_limiting_enabled') !== false,
        defaultLimit: await this.getConfig('rate_limiting_default') || 100,
        window: await this.getConfig('rate_limiting_window') || 60
      },
      monitoring: {
        enabled: await this.getConfig('monitoring_enabled') !== false,
        interval: await this.getConfig('monitoring_interval') || 30000
      },
      alerts: {
        enabled: await this.getConfig('alerts_enabled') !== false,
        webhook: await this.getConfig('alerts_webhook') || null
      }
    };
  }

  async updateSystemConfig(updates) {
    if (updates.loadBalancing) {
      if (updates.loadBalancing.strategy) {
        await this.setConfig('load_balancing_strategy', updates.loadBalancing.strategy);
      }
      if (updates.loadBalancing.enabled !== undefined) {
        await this.setConfig('load_balancing_enabled', updates.loadBalancing.enabled);
      }
    }

    if (updates.rateLimiting) {
      if (updates.rateLimiting.enabled !== undefined) {
        await this.setConfig('rate_limiting_enabled', updates.rateLimiting.enabled);
      }
      if (updates.rateLimiting.defaultLimit) {
        await this.setConfig('rate_limiting_default', updates.rateLimiting.defaultLimit);
      }
      if (updates.rateLimiting.window) {
        await this.setConfig('rate_limiting_window', updates.rateLimiting.window);
      }
    }

    if (updates.monitoring) {
      if (updates.monitoring.enabled !== undefined) {
        await this.setConfig('monitoring_enabled', updates.monitoring.enabled);
      }
      if (updates.monitoring.interval) {
        await this.setConfig('monitoring_interval', updates.monitoring.interval);
      }
    }

    if (updates.alerts) {
      if (updates.alerts.enabled !== undefined) {
        await this.setConfig('alerts_enabled', updates.alerts.enabled);
      }
      if (updates.alerts.webhook) {
        await this.setConfig('alerts_webhook', updates.alerts.webhook);
      }
    }

    return await this.getSystemConfig();
  }

  async getNodeConfig(nodeId) {
    return await this.getConfig(`node:${nodeId}`);
  }

  async setNodeConfig(nodeId, nodeConfig) {
    await this.setConfig(`node:${nodeId}`, nodeConfig);
  }

  async getAllConfigs() {
    const keys = await this.redis.keys('config:*');
    const configs = {};

    for (const key of keys) {
      const configKey = key.replace('config:', '');
      configs[configKey] = await this.getConfig(configKey);
    }

    return configs;
  }

  async resetConfig(key) {
    await this.redis.del(`config:${key}`);
  }

  async resetAllConfigs() {
    const keys = await this.redis.keys('config:*');
    if (keys.length > 0) {
      await this.redis.del(keys);
    }
  }
}

module.exports = ConfigManager;
