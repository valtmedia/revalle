const GeoRouter = require('../src/geoRouter');

// Mock NodeManager
const mockNodeManager = {
  getAvailableNodes: jest.fn(),
  getAllNodes: jest.fn()
};

describe('GeoRouter', () => {
  let geoRouter;

  beforeEach(() => {
    geoRouter = new GeoRouter(mockNodeManager);
    
    // Reset mocks with default data
    mockNodeManager.getAvailableNodes.mockResolvedValue([
      { id: 'n1', host: '1.1.1.1', port: 3128, region: 'us-east-1', status: 'active', health: 'healthy', currentLoad: 50, capacity: 1000 },
      { id: 'n2', host: '2.2.2.2', port: 3128, region: 'eu-west-1', status: 'active', health: 'healthy', currentLoad: 30, capacity: 1000 },
      { id: 'n3', host: '3.3.3.3', port: 3128, region: 'ap-northeast-1', status: 'active', health: 'healthy', currentLoad: 80, capacity: 1000 },
      { id: 'n4', host: '4.4.4.4', port: 3128, region: 'us-west-2', status: 'active', health: 'healthy', currentLoad: 20, capacity: 1000 }
    ]);
    
    mockNodeManager.getAllNodes.mockResolvedValue([
      { id: 'n1', host: '1.1.1.1', port: 3128, region: 'us-east-1', status: 'active', health: 'healthy', currentLoad: 50, capacity: 1000 },
      { id: 'n2', host: '2.2.2.2', port: 3128, region: 'eu-west-1', status: 'active', health: 'healthy', currentLoad: 30, capacity: 1000 },
      { id: 'n3', host: '3.3.3.3', port: 3128, region: 'ap-northeast-1', status: 'active', health: 'healthy', currentLoad: 80, capacity: 1000 },
      { id: 'n4', host: '4.4.4.4', port: 3128, region: 'us-west-2', status: 'active', health: 'healthy', currentLoad: 20, capacity: 1000 }
    ]);
  });

  test('should route to nearest node', async () => {
    const node = await geoRouter.routeRequest('us-east-1');
    expect(node).toBeDefined();
    // Should prefer us-east-1 or nearby US region
    expect(['us-east-1', 'us-west-2']).toContain(node.region);
  });

  test('should prefer same-region node', async () => {
    const node = await geoRouter.routeRequest('eu-west-1');
    expect(node.region).toBe('eu-west-1');
  });

  test('should return null when no nodes available', async () => {
    mockNodeManager.getAvailableNodes.mockResolvedValue([]);
    const node = await geoRouter.routeRequest('us-east-1');
    expect(node).toBeNull();
  });

  test('should block geo-blocked regions', async () => {
    geoRouter.addGeoBlock('blocked-region');
    const node = await geoRouter.routeRequest('blocked-region');
    expect(node).toBeNull();
  });

  test('should unblock regions', async () => {
    geoRouter.addGeoBlock('temp-block');
    geoRouter.removeGeoBlock('temp-block');
    const node = await geoRouter.routeRequest('temp-block');
    expect(node).toBeDefined(); // Should work now
  });

  test('should add routing rules', () => {
    const rule = geoRouter.addRoutingRule({
      name: 'Test Rule',
      priority: 10,
      action: 'prefer_region',
      parameters: { regions: ['us-east-1'] }
    });

    expect(rule.id).toBeDefined();
    expect(rule.name).toBe('Test Rule');
    expect(rule.enabled).toBe(true);
  });

  test('should remove routing rules', () => {
    const rule = geoRouter.addRoutingRule({ name: 'To Remove', action: 'block' });
    
    const removed = geoRouter.removeRoutingRule(rule.id);
    expect(removed).toBe(true);
    
    const removedAgain = geoRouter.removeRoutingRule(rule.id);
    expect(removedAgain).toBe(false);
  });

  test('should apply exclude_region rule', async () => {
    geoRouter.addRoutingRule({
      name: 'Exclude EU',
      action: 'exclude_region',
      parameters: { regions: ['eu-west-1'] }
    });

    const node = await geoRouter.routeRequest('us-east-1');
    expect(node.region).not.toBe('eu-west-1');
  });

  test('should apply force_region rule', async () => {
    geoRouter.addRoutingRule({
      name: 'Force US',
      action: 'force_region',
      parameters: { regions: ['us-east-1', 'us-west-2'] }
    });

    const node = await geoRouter.routeRequest('ap-northeast-1');
    expect(['us-east-1', 'us-west-2']).toContain(node.region);
  });

  test('should filter by GDPR compliance', async () => {
    const node = await geoRouter.routeRequest('eu-west-1', {
      complianceRequired: 'gdpr'
    });
    
    // GDPR requires EU nodes for EU traffic
    if (node) {
      expect(node.region).toBe('eu-west-1'); // Only EU node available
    }
  });

  test('should get node distribution', async () => {
    const distribution = await geoRouter.getNodeDistribution();
    expect(distribution).toBeDefined();
    expect(distribution['us-east-1']).toBeDefined();
    expect(distribution['us-east-1'].total).toBe(1);
    expect(distribution['us-east-1'].active).toBe(1);
  });

  test('should get stats', () => {
    const stats = geoRouter.getStats();
    expect(stats.regionCount).toBeGreaterThan(0);
    expect(Array.isArray(stats.geoBlockedRegions)).toBe(true);
    expect(Array.isArray(stats.complianceZones)).toBe(true);
  });

  test('should have default compliance zones', () => {
    const stats = geoRouter.getStats();
    expect(stats.complianceZones).toContain('gdpr');
    expect(stats.complianceZones).toContain('data-sovereignty-us');
  });

  test('should update latency cache', () => {
    geoRouter.updateLatency('us-east-1', 'eu-west-1', 85);
    const stats = geoRouter.getStats();
    expect(stats.latencyCacheSize).toBe(1);
  });

  test('should set custom compliance zones', () => {
    geoRouter.setComplianceZone('custom-zone', {
      sourceRegions: ['ap-northeast-1'],
      allowedNodeRegions: ['ap-northeast-1', 'ap-southeast-1'],
      description: 'Custom zone',
      regulation: 'Custom'
    });

    const stats = geoRouter.getStats();
    expect(stats.complianceZones).toContain('custom-zone');
  });

  test('proximity scoring should be correct', () => {
    // Same region = 1.0
    expect(geoRouter._getProximityScore('us-east-1', 'us-east-1')).toBe(1.0);
    
    // In proximity list
    expect(geoRouter._getProximityScore('us-east-1', 'us-east-2')).toBe(0.8);
    
    // Same continent but not in proximity
    expect(geoRouter._getProximityScore('us-east-1', 'us-west-2')).toBeGreaterThanOrEqual(0.6);
    
    // Different continent
    expect(geoRouter._getProximityScore('us-east-1', 'ap-northeast-1')).toBeLessThan(0.5);
  });
});
