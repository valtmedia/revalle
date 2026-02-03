const Redis = require('redis');
const axios = require('axios');
const config = require('../config');

class NodeManager {
  constructor() {
    this.redis = Redis.createClient({
      url: config.redis.url
    });
    this.redis.connect().catch(console.error);
  }

  async registerNode(nodeData) {
    const node = {
      id: nodeData.id || this.generateNodeId(),
      name: nodeData.name || `node-${Date.now()}`,
      host: nodeData.host,
      port: nodeData.port || 3128,
      region: nodeData.region || 'us-east-1',
      status: 'active',
      capacity: nodeData.capacity || 1000, // Max concurrent connections
      currentLoad: 0,
      health: 'healthy',
      lastHeartbeat: new Date().toISOString(),
      metadata: nodeData.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Store in Redis
    await this.redis.set(`node:${node.id}`, JSON.stringify(node));
    await this.redis.sAdd('nodes:active', node.id);
    await this.redis.zAdd('nodes:load', {
      score: node.currentLoad,
      value: node.id
    });

    console.log(`Node registered: ${node.id} at ${node.host}:${node.port}`);
    return node;
  }

  async getNode(nodeId) {
    const data = await this.redis.get(`node:${nodeId}`);
    return data ? JSON.parse(data) : null;
  }

  async getAllNodes() {
    const nodeIds = await this.redis.sMembers('nodes:active');
    const nodes = [];
    
    for (const id of nodeIds) {
      const node = await this.getNode(id);
      if (node) {
        nodes.push(node);
      }
    }
    
    return nodes;
  }

  async updateNode(nodeId, updates) {
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error('Node not found');
    }

    Object.assign(node, updates, {
      updatedAt: new Date().toISOString()
    });

    await this.redis.set(`node:${nodeId}`, JSON.stringify(node));
    return node;
  }

  async removeNode(nodeId) {
    await this.redis.del(`node:${nodeId}`);
    await this.redis.sRem('nodes:active', nodeId);
    await this.redis.zRem('nodes:load', nodeId);
    console.log(`Node removed: ${nodeId}`);
  }

  async updateHeartbeat(nodeId, heartbeatData) {
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error('Node not found');
    }

    node.lastHeartbeat = new Date().toISOString();
    node.currentLoad = heartbeatData.load || node.currentLoad;
    node.health = heartbeatData.health || node.health;
    node.metrics = heartbeatData.metrics || node.metrics;

    // Update load score
    await this.redis.zAdd('nodes:load', {
      score: node.currentLoad,
      value: nodeId
    });

    return await this.updateNode(nodeId, node);
  }

  async checkNodeHealth() {
    const nodes = await this.getAllNodes();
    const now = Date.now();

    for (const node of nodes) {
      const lastHeartbeat = new Date(node.lastHeartbeat).getTime();
      const timeSinceHeartbeat = now - lastHeartbeat;

      // Mark as inactive if no heartbeat for 2 minutes
      if (timeSinceHeartbeat > 120000) {
        if (node.status === 'active') {
          console.log(`Node ${node.id} marked as inactive (no heartbeat)`);
          await this.updateNode(node.id, { status: 'inactive', health: 'unhealthy' });
          await this.redis.sRem('nodes:active', node.id);
        }
      } else {
        // Try to ping the node
        try {
          const response = await axios.get(`http://${node.host}:${node.port}`, {
            timeout: 5000,
            validateStatus: () => true
          });
          
          if (node.status !== 'active') {
            console.log(`Node ${node.id} marked as active`);
            await this.updateNode(node.id, { status: 'active', health: 'healthy' });
            await this.redis.sAdd('nodes:active', node.id);
          }
        } catch (error) {
          if (node.status === 'active') {
            console.log(`Node ${node.id} health check failed`);
            await this.updateNode(node.id, { health: 'unhealthy' });
          }
        }
      }
    }
  }

  generateNodeId() {
    return `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async getAvailableNodes() {
    const nodes = await this.getAllNodes();
    return nodes.filter(n => n.status === 'active' && n.health === 'healthy');
  }
}

module.exports = NodeManager;
