const { logger } = require('./logger');
const metrics = require('./prometheusMetrics');

/**
 * Geographic Traffic Router
 * Routes proxy requests based on geographic location, latency,
 * compliance requirements, and custom routing rules
 */
class GeoRouter {
  constructor(nodeManager) {
    this.nodeManager = nodeManager;
    
    // Region hierarchy for proximity routing
    this.regionHierarchy = {
      'us-east-1': { continent: 'NA', country: 'US', proximity: ['us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1'] },
      'us-east-2': { continent: 'NA', country: 'US', proximity: ['us-east-1', 'us-west-1', 'us-west-2', 'ca-central-1'] },
      'us-west-1': { continent: 'NA', country: 'US', proximity: ['us-west-2', 'us-east-1', 'us-east-2', 'ca-central-1'] },
      'us-west-2': { continent: 'NA', country: 'US', proximity: ['us-west-1', 'us-east-1', 'us-east-2', 'ca-central-1'] },
      'ca-central-1': { continent: 'NA', country: 'CA', proximity: ['us-east-1', 'us-east-2', 'us-west-1'] },
      'eu-west-1': { continent: 'EU', country: 'IE', proximity: ['eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1'] },
      'eu-west-2': { continent: 'EU', country: 'GB', proximity: ['eu-west-1', 'eu-west-3', 'eu-central-1'] },
      'eu-west-3': { continent: 'EU', country: 'FR', proximity: ['eu-west-1', 'eu-west-2', 'eu-central-1'] },
      'eu-central-1': { continent: 'EU', country: 'DE', proximity: ['eu-west-1', 'eu-west-2', 'eu-north-1'] },
      'eu-north-1': { continent: 'EU', country: 'SE', proximity: ['eu-central-1', 'eu-west-1', 'eu-west-2'] },
      'ap-southeast-1': { continent: 'AS', country: 'SG', proximity: ['ap-southeast-2', 'ap-northeast-1', 'ap-south-1'] },
      'ap-southeast-2': { continent: 'AS', country: 'AU', proximity: ['ap-southeast-1', 'ap-northeast-1'] },
      'ap-northeast-1': { continent: 'AS', country: 'JP', proximity: ['ap-northeast-2', 'ap-southeast-1', 'us-west-2'] },
      'ap-northeast-2': { continent: 'AS', country: 'KR', proximity: ['ap-northeast-1', 'ap-southeast-1'] },
      'ap-south-1': { continent: 'AS', country: 'IN', proximity: ['ap-southeast-1', 'eu-west-1'] },
      'sa-east-1': { continent: 'SA', country: 'BR', proximity: ['us-east-1', 'us-east-2'] },
      'me-south-1': { continent: 'AS', country: 'BH', proximity: ['eu-west-1', 'ap-south-1'] },
      'af-south-1': { continent: 'AF', country: 'ZA', proximity: ['eu-west-1', 'me-south-1'] }
    };

    // Routing rules
    this.routingRules = [];
    
    // Geo-blocking rules
    this.geoBlockList = new Set();
    
    // Compliance zones (e.g., GDPR requires EU nodes for EU traffic)
    this.complianceZones = new Map();
    
    // Latency cache
    this.latencyCache = new Map(); // sourceRegion:destRegion -> latency
    
    // Initialize default compliance zones
    this._initDefaultComplianceZones();
  }

  /**
   * Route a request to the best node based on geography
   */
  async routeRequest(sourceRegion, options = {}) {
    const { targetCountry, protocol, complianceRequired, preferredRegions } = options;
    
    // Get available nodes
    const nodes = await this.nodeManager.getAvailableNodes();
    if (nodes.length === 0) {
      return null;
    }
    
    // Check geo-blocking
    if (sourceRegion && this.geoBlockList.has(sourceRegion)) {
      logger.warn('Geo-blocked request', { sourceRegion });
      metrics.inc('proxy_errors_total', { error_type: 'geo_blocked', region: sourceRegion });
      return null;
    }
    
    // Apply compliance rules
    let eligibleNodes = nodes;
    if (complianceRequired) {
      eligibleNodes = this._filterByCompliance(nodes, sourceRegion, complianceRequired);
    }
    
    // Apply custom routing rules
    eligibleNodes = this._applyRoutingRules(eligibleNodes, { sourceRegion, targetCountry, protocol });
    
    if (eligibleNodes.length === 0) {
      logger.warn('No eligible nodes after filtering', { sourceRegion, complianceRequired });
      return nodes[0]; // Fallback to first available
    }
    
    // Score and rank nodes
    const scoredNodes = eligibleNodes.map(node => ({
      node,
      score: this._calculateNodeScore(node, sourceRegion, options)
    }));
    
    // Sort by score (highest first)
    scoredNodes.sort((a, b) => b.score - a.score);
    
    const selected = scoredNodes[0].node;
    
    metrics.inc('proxy_requests_total', {
      region: selected.region || 'unknown',
      protocol: protocol || 'http'
    });
    
    return selected;
  }

  /**
   * Calculate a routing score for a node
   */
  _calculateNodeScore(node, sourceRegion, options = {}) {
    let score = 100;
    
    // Proximity score (0-40 points)
    score += this._getProximityScore(sourceRegion, node.region) * 40;
    
    // Load score (0-30 points) - prefer less loaded nodes
    const utilization = node.currentLoad / (node.capacity || 1000);
    score += (1 - utilization) * 30;
    
    // Health score (0-20 points)
    if (node.health === 'healthy') score += 20;
    else if (node.health === 'degraded') score += 10;
    
    // Preferred region bonus (0-10 points)
    if (options.preferredRegions && options.preferredRegions.includes(node.region)) {
      score += 10;
    }
    
    // Latency penalty
    const cachedLatency = this.latencyCache.get(`${sourceRegion}:${node.region}`);
    if (cachedLatency) {
      score -= cachedLatency / 100; // Penalize high latency
    }
    
    return Math.max(0, score);
  }

  /**
   * Get proximity score between two regions (0.0 to 1.0)
   */
  _getProximityScore(sourceRegion, nodeRegion) {
    if (!sourceRegion || !nodeRegion) return 0.5;
    if (sourceRegion === nodeRegion) return 1.0;
    
    const sourceInfo = this.regionHierarchy[sourceRegion];
    const nodeInfo = this.regionHierarchy[nodeRegion];
    
    if (!sourceInfo || !nodeInfo) return 0.5;
    
    // Same country
    if (sourceInfo.country === nodeInfo.country) return 0.9;
    
    // In proximity list
    if (sourceInfo.proximity && sourceInfo.proximity.includes(nodeRegion)) return 0.8;
    
    // Same continent
    if (sourceInfo.continent === nodeInfo.continent) return 0.6;
    
    // Adjacent continents
    const adjacentContinents = {
      'NA': ['SA', 'EU'],
      'SA': ['NA'],
      'EU': ['NA', 'AF', 'AS'],
      'AF': ['EU', 'AS'],
      'AS': ['EU', 'AF'],
      'OC': ['AS']
    };
    
    if (adjacentContinents[sourceInfo.continent]?.includes(nodeInfo.continent)) return 0.3;
    
    return 0.1; // Far away
  }

  /**
   * Add a routing rule
   */
  addRoutingRule(rule) {
    const routingRule = {
      id: rule.id || `rule-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      name: rule.name,
      priority: rule.priority || 0,
      conditions: rule.conditions || {},
      action: rule.action, // 'prefer_region', 'exclude_region', 'force_region', 'block'
      parameters: rule.parameters || {},
      enabled: rule.enabled !== false,
      createdAt: new Date().toISOString()
    };
    
    this.routingRules.push(routingRule);
    this.routingRules.sort((a, b) => b.priority - a.priority);
    
    logger.info('Routing rule added', { ruleId: routingRule.id, name: routingRule.name });
    return routingRule;
  }

  /**
   * Remove a routing rule
   */
  removeRoutingRule(ruleId) {
    const idx = this.routingRules.findIndex(r => r.id === ruleId);
    if (idx >= 0) {
      this.routingRules.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Add geo-blocking for a region
   */
  addGeoBlock(region) {
    this.geoBlockList.add(region);
    logger.info('Geo-block added', { region });
  }

  /**
   * Remove geo-blocking for a region
   */
  removeGeoBlock(region) {
    this.geoBlockList.delete(region);
    logger.info('Geo-block removed', { region });
  }

  /**
   * Set compliance zone requirement
   */
  setComplianceZone(zoneName, config) {
    this.complianceZones.set(zoneName, {
      name: zoneName,
      sourceRegions: config.sourceRegions || [],
      allowedNodeRegions: config.allowedNodeRegions || [],
      description: config.description || '',
      regulation: config.regulation || '',
      updatedAt: new Date().toISOString()
    });
    
    logger.info('Compliance zone updated', { zoneName });
  }

  /**
   * Update latency measurement between regions
   */
  updateLatency(sourceRegion, destRegion, latencyMs) {
    this.latencyCache.set(`${sourceRegion}:${destRegion}`, latencyMs);
  }

  /**
   * Get routing statistics
   */
  getStats() {
    return {
      routingRules: this.routingRules.length,
      geoBlockedRegions: [...this.geoBlockList],
      complianceZones: [...this.complianceZones.keys()],
      latencyCacheSize: this.latencyCache.size,
      regionCount: Object.keys(this.regionHierarchy).length
    };
  }

  /**
   * Get all routing rules
   */
  getRules() {
    return this.routingRules;
  }

  /**
   * Get node distribution by region
   */
  async getNodeDistribution() {
    const nodes = await this.nodeManager.getAllNodes();
    const distribution = {};
    
    for (const node of nodes) {
      const region = node.region || 'unknown';
      if (!distribution[region]) {
        distribution[region] = {
          total: 0,
          active: 0,
          inactive: 0,
          totalCapacity: 0,
          totalLoad: 0
        };
      }
      
      distribution[region].total++;
      if (node.status === 'active') {
        distribution[region].active++;
      } else {
        distribution[region].inactive++;
      }
      distribution[region].totalCapacity += node.capacity || 0;
      distribution[region].totalLoad += node.currentLoad || 0;
    }
    
    return distribution;
  }

  // Private methods

  _initDefaultComplianceZones() {
    // GDPR - EU data must stay in EU
    this.complianceZones.set('gdpr', {
      name: 'GDPR',
      sourceRegions: ['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1'],
      allowedNodeRegions: ['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1'],
      description: 'GDPR requires EU data to be processed within the EU',
      regulation: 'EU GDPR'
    });
    
    // Data sovereignty - Keep data within country
    this.complianceZones.set('data-sovereignty-us', {
      name: 'US Data Sovereignty',
      sourceRegions: ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'],
      allowedNodeRegions: ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'],
      description: 'US data must be processed within US regions',
      regulation: 'US Data Sovereignty'
    });
  }

  _filterByCompliance(nodes, sourceRegion, complianceZoneName) {
    const zone = this.complianceZones.get(complianceZoneName);
    if (!zone) return nodes;
    
    // Check if source region falls under this compliance zone
    if (!zone.sourceRegions.includes(sourceRegion)) {
      return nodes; // Zone doesn't apply to this source
    }
    
    return nodes.filter(n => zone.allowedNodeRegions.includes(n.region));
  }

  _applyRoutingRules(nodes, context) {
    let filtered = [...nodes];
    
    for (const rule of this.routingRules) {
      if (!rule.enabled) continue;
      
      // Check if conditions match
      if (!this._matchConditions(rule.conditions, context)) continue;
      
      // Apply action
      switch (rule.action) {
        case 'exclude_region':
          filtered = filtered.filter(n => !rule.parameters.regions?.includes(n.region));
          break;
        case 'force_region':
          const forced = filtered.filter(n => rule.parameters.regions?.includes(n.region));
          if (forced.length > 0) filtered = forced;
          break;
        case 'block':
          return []; // Block all traffic
        case 'prefer_region':
          // Boost score for preferred regions (handled in scoring)
          break;
      }
    }
    
    return filtered;
  }

  _matchConditions(conditions, context) {
    if (!conditions || Object.keys(conditions).length === 0) return true;
    
    if (conditions.sourceRegion && conditions.sourceRegion !== context.sourceRegion) return false;
    if (conditions.targetCountry && conditions.targetCountry !== context.targetCountry) return false;
    if (conditions.protocol && conditions.protocol !== context.protocol) return false;
    
    return true;
  }
}

module.exports = GeoRouter;
