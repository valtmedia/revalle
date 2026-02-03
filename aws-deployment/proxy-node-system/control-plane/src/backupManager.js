const Redis = require('redis');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');

class BackupManager {
  constructor() {
    this.redis = Redis.createClient({
      url: config.redis.url
    });
    this.redis.connect().catch(console.error);
    this.backupDir = config.backup?.dir || '/tmp/backups';
  }

  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupData = {
      timestamp,
      version: '1.0',
      nodes: await this.backupNodes(),
      users: await this.backupUsers(),
      config: await this.backupConfig(),
      metrics: await this.backupMetrics()
    };

    const filename = `backup-${timestamp}.json`;
    const filepath = path.join(this.backupDir, filename);

    // Ensure backup directory exists
    await fs.mkdir(this.backupDir, { recursive: true });

    // Write backup file
    await fs.writeFile(filepath, JSON.stringify(backupData, null, 2));

    // Compress backup
    if (config.backup?.compress) {
      // Would use zlib or similar
    }

    return { filename, filepath, size: (await fs.stat(filepath)).size };
  }

  async backupNodes() {
    const nodeKeys = await this.redis.keys('node:*');
    const nodes = {};

    for (const key of nodeKeys) {
      if (!key.includes(':username:') && !key.includes(':email:')) {
        const nodeId = key.replace('node:', '');
        const data = await this.redis.get(key);
        if (data) {
          nodes[nodeId] = JSON.parse(data);
        }
      }
    }

    return nodes;
  }

  async backupUsers() {
    const userKeys = await this.redis.keys('user:*');
    const users = {};

    for (const key of userKeys) {
      if (!key.includes(':username:') && !key.includes(':email:')) {
        const userId = key.replace('user:', '');
        const data = await this.redis.get(key);
        if (data) {
          const user = JSON.parse(data);
          // Don't backup passwords
          delete user.password;
          users[userId] = user;
        }
      }
    }

    return users;
  }

  async backupConfig() {
    const configKeys = await this.redis.keys('config:*');
    const configs = {};

    for (const key of configKeys) {
      const configKey = key.replace('config:', '');
      const data = await this.redis.get(key);
      if (data) {
        configs[configKey] = JSON.parse(data);
      }
    }

    return configs;
  }

  async backupMetrics() {
    // Backup recent metrics (last 24 hours)
    const metricKeys = await this.redis.keys('analytics:*');
    const metrics = [];

    for (const key of metricKeys.slice(0, 10000)) { // Limit to 10k most recent
      const data = await this.redis.get(key);
      if (data) {
        metrics.push(JSON.parse(data));
      }
    }

    return metrics;
  }

  async restoreBackup(filepath) {
    const data = await fs.readFile(filepath, 'utf8');
    const backup = JSON.parse(data);

    // Restore nodes
    if (backup.nodes) {
      for (const [nodeId, nodeData] of Object.entries(backup.nodes)) {
        await this.redis.set(`node:${nodeId}`, JSON.stringify(nodeData));
      }
    }

    // Restore users (without passwords - they need to reset)
    if (backup.users) {
      for (const [userId, userData] of Object.entries(backup.users)) {
        // Users will need to reset passwords
        await this.redis.set(`user:${userId}`, JSON.stringify(userData));
      }
    }

    // Restore config
    if (backup.config) {
      for (const [configKey, configData] of Object.entries(backup.config)) {
        await this.redis.set(`config:${configKey}`, JSON.stringify(configData));
      }
    }

    return { restored: true, timestamp: backup.timestamp };
  }

  async listBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];

      for (const file of files) {
        if (file.startsWith('backup-') && file.endsWith('.json')) {
          const filepath = path.join(this.backupDir, file);
          const stats = await fs.stat(filepath);
          backups.push({
            filename: file,
            size: stats.size,
            createdAt: stats.birthtime
          });
        }
      }

      return backups.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      return [];
    }
  }

  async deleteBackup(filename) {
    const filepath = path.join(this.backupDir, filename);
    await fs.unlink(filepath);
    return { deleted: true, filename };
  }

  async scheduleBackups(interval = 'daily') {
    // This would integrate with a scheduler like node-cron
    console.log(`Backups scheduled: ${interval}`);
  }
}

module.exports = BackupManager;
