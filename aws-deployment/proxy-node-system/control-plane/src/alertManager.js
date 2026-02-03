const axios = require('axios');
const NodeManager = require('./nodeManager');
const config = require('../config');

class AlertManager {
  constructor() {
    this.nodeManager = new NodeManager();
    this.alertRules = [];
    this.alertHistory = [];
  }

  addRule(rule) {
    this.alertRules.push({
      id: rule.id || this.generateRuleId(),
      name: rule.name,
      condition: rule.condition, // 'node_down', 'high_latency', 'quota_exceeded', etc.
      threshold: rule.threshold,
      action: rule.action || 'notify', // 'notify', 'scale', 'disable_node'
      enabled: rule.enabled !== false,
      createdAt: new Date().toISOString()
    });
  }

  async checkAlerts() {
    const alerts = [];

    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;

      try {
        const triggered = await this.evaluateRule(rule);
        if (triggered) {
          const alert = {
            id: this.generateAlertId(),
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity || 'warning',
            message: this.getAlertMessage(rule),
            timestamp: new Date().toISOString()
          };

          alerts.push(alert);
          await this.handleAlert(alert, rule);
        }
      } catch (error) {
        console.error(`Error evaluating rule ${rule.id}:`, error);
      }
    }

    return alerts;
  }

  async evaluateRule(rule) {
    switch (rule.condition) {
      case 'node_down':
        return await this.checkNodeDown(rule);
      case 'high_latency':
        return await this.checkHighLatency(rule);
      case 'high_load':
        return await this.checkHighLoad(rule);
      case 'quota_exceeded':
        return await this.checkQuotaExceeded(rule);
      case 'low_availability':
        return await this.checkLowAvailability(rule);
      default:
        return false;
    }
  }

  async checkNodeDown(rule) {
    const nodes = await this.nodeManager.getAllNodes();
    const inactiveNodes = nodes.filter(n => n.status !== 'active');
    return inactiveNodes.length >= (rule.threshold || 1);
  }

  async checkHighLatency(rule) {
    const nodes = await this.nodeManager.getAvailableNodes();
    const highLatencyNodes = nodes.filter(n => 
      n.metrics?.averageLatency > (rule.threshold || 1000)
    );
    return highLatencyNodes.length > 0;
  }

  async checkHighLoad(rule) {
    const nodes = await this.nodeManager.getAvailableNodes();
    const highLoadNodes = nodes.filter(n => {
      const utilization = (n.currentLoad / n.capacity) * 100;
      return utilization > (rule.threshold || 80);
    });
    return highLoadNodes.length > 0;
  }

  async checkQuotaExceeded(rule) {
    // This would check user quotas
    return false; // Placeholder
  }

  async checkLowAvailability(rule) {
    const nodes = await this.nodeManager.getAllNodes();
    const activeNodes = nodes.filter(n => n.status === 'active');
    const availability = (activeNodes.length / nodes.length) * 100;
    return availability < (rule.threshold || 50);
  }

  async handleAlert(alert, rule) {
    // Store alert
    this.alertHistory.push(alert);
    if (this.alertHistory.length > 1000) {
      this.alertHistory.shift();
    }

    // Execute action
    switch (rule.action) {
      case 'notify':
        await this.sendNotification(alert);
        break;
      case 'scale':
        await this.triggerScaling(alert);
        break;
      case 'disable_node':
        await this.disableNode(alert);
        break;
    }
  }

  async sendNotification(alert) {
    // Send to webhook, email, Slack, etc.
    if (config.webhook_url) {
      try {
        await axios.post(config.webhook_url, {
          text: `Alert: ${alert.ruleName}`,
          message: alert.message,
          severity: alert.severity,
          timestamp: alert.timestamp
        });
      } catch (error) {
        console.error('Failed to send webhook notification:', error);
      }
    }

    console.log(`ALERT: ${alert.message}`);
  }

  async triggerScaling(alert) {
    // Trigger auto-scaling
    console.log(`Scaling triggered by alert: ${alert.ruleName}`);
    // Implementation would call AWS Auto Scaling API
  }

  async disableNode(alert) {
    // Disable problematic node
    console.log(`Node disable triggered by alert: ${alert.ruleName}`);
  }

  getAlertMessage(rule) {
    const messages = {
      'node_down': 'One or more proxy nodes are down',
      'high_latency': 'High latency detected on proxy nodes',
      'high_load': 'High load detected on proxy nodes',
      'quota_exceeded': 'User quota exceeded',
      'low_availability': 'Low availability of proxy nodes'
    };
    return messages[rule.condition] || 'Alert triggered';
  }

  generateRuleId() {
    return `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateAlertId() {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async getAlertHistory(limit = 100) {
    return this.alertHistory.slice(-limit);
  }

  async getActiveAlerts() {
    return this.alertHistory.filter(a => 
      new Date() - new Date(a.timestamp) < 3600000 // Last hour
    );
  }
}

module.exports = AlertManager;
