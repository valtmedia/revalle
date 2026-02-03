const NodeManager = require('./nodeManager');

class LoadBalancer {
  constructor(nodeManager) {
    this.nodeManager = nodeManager;
    this.strategy = 'round-robin'; // round-robin, least-connections, weighted
    this.currentIndex = 0;
  }

  async getNextNode(options = {}) {
    const strategy = options.strategy || this.strategy;
    const availableNodes = await this.nodeManager.getAvailableNodes();

    if (availableNodes.length === 0) {
      return null;
    }

    switch (strategy) {
      case 'round-robin':
        return this.roundRobin(availableNodes);
      case 'least-connections':
        return this.leastConnections(availableNodes);
      case 'weighted':
        return this.weighted(availableNodes);
      case 'geographic':
        return this.geographic(availableNodes, options.region);
      default:
        return this.roundRobin(availableNodes);
    }
  }

  roundRobin(nodes) {
    const node = nodes[this.currentIndex % nodes.length];
    this.currentIndex++;
    return node;
  }

  leastConnections(nodes) {
    return nodes.reduce((min, node) => 
      node.currentLoad < min.currentLoad ? node : min
    );
  }

  weighted(nodes) {
    // Weight based on capacity and current load
    const weightedNodes = nodes.map(node => ({
      node,
      weight: node.capacity / (node.currentLoad + 1)
    }));

    const totalWeight = weightedNodes.reduce((sum, w) => sum + w.weight, 0);
    let random = Math.random() * totalWeight;

    for (const weighted of weightedNodes) {
      random -= weighted.weight;
      if (random <= 0) {
        return weighted.node;
      }
    }

    return nodes[0];
  }

  geographic(nodes, region) {
    // Prefer nodes in the same region
    const regionalNodes = nodes.filter(n => n.region === region);
    if (regionalNodes.length > 0) {
      return this.leastConnections(regionalNodes);
    }
    return this.leastConnections(nodes);
  }

  async getStats() {
    const nodes = await this.nodeManager.getAllNodes();
    const availableNodes = nodes.filter(n => n.status === 'active');

    return {
      totalNodes: nodes.length,
      availableNodes: availableNodes.length,
      totalCapacity: nodes.reduce((sum, n) => sum + n.capacity, 0),
      currentLoad: nodes.reduce((sum, n) => sum + n.currentLoad, 0),
      averageLoad: availableNodes.length > 0 
        ? nodes.reduce((sum, n) => sum + n.currentLoad, 0) / availableNodes.length 
        : 0,
      strategy: this.strategy,
      nodes: availableNodes.map(n => ({
        id: n.id,
        name: n.name,
        load: n.currentLoad,
        capacity: n.capacity,
        utilization: (n.currentLoad / n.capacity * 100).toFixed(2) + '%'
      }))
    };
  }

  setStrategy(strategy) {
    if (['round-robin', 'least-connections', 'weighted', 'geographic'].includes(strategy)) {
      this.strategy = strategy;
      return true;
    }
    return false;
  }
}

module.exports = LoadBalancer;
