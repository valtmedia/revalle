const Analytics = require('../src/analytics');

// Mock Redis
jest.mock('redis', () => {
  const store = new Map();
  return {
    createClient: () => ({
      connect: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockImplementation(key => store.get(key) || null),
      set: jest.fn().mockImplementation((key, val) => { store.set(key, val); }),
      setEx: jest.fn().mockImplementation((key, ttl, val) => { store.set(key, val); }),
      incr: jest.fn().mockImplementation(key => {
        const val = parseInt(store.get(key) || '0') + 1;
        store.set(key, val.toString());
        return val;
      }),
      incrBy: jest.fn().mockImplementation((key, amount) => {
        const val = parseInt(store.get(key) || '0') + amount;
        store.set(key, val.toString());
        return val;
      }),
      keys: jest.fn().mockImplementation(pattern => {
        const prefix = pattern.replace('*', '');
        return [...store.keys()].filter(k => k.startsWith(prefix));
      }),
      lPush: jest.fn(),
      lTrim: jest.fn(),
      lRange: jest.fn().mockResolvedValue([])
    })
  };
});

describe('Analytics', () => {
  let analytics;

  beforeAll(() => {
    analytics = new Analytics();
  });

  test('should record events', async () => {
    await analytics.recordEvent('test:event', { testData: true });
    // Event should be recorded without error
  });

  test('should record proxy requests', async () => {
    await analytics.recordProxyRequest('node-1', {
      bytes: 1024,
      latency: 50,
      region: 'us-east-1'
    });
    // Should record without error
  });

  test('should record errors', async () => {
    await analytics.recordError('connection_timeout', {
      nodeId: 'node-1',
      target: 'example.com'
    });
    // Should record without error
  });

  test('should get stats for different time ranges', async () => {
    const stats1h = await analytics.getStats('1h');
    expect(stats1h).toHaveProperty('totalRequests');
    expect(stats1h.timeRange).toBe('1h');

    const stats24h = await analytics.getStats('24h');
    expect(stats24h.timeRange).toBe('24h');

    const stats7d = await analytics.getStats('7d');
    expect(stats7d.timeRange).toBe('7d');

    const stats30d = await analytics.getStats('30d');
    expect(stats30d.timeRange).toBe('30d');
  });

  test('should get hourly stats', async () => {
    const hourlyStats = await analytics.getHourlyStats(24);
    expect(Array.isArray(hourlyStats)).toBe(true);
    expect(hourlyStats.length).toBe(24);
    
    hourlyStats.forEach(stat => {
      expect(stat).toHaveProperty('hour');
      expect(stat).toHaveProperty('requests');
      expect(stat).toHaveProperty('errors');
    });
  });

  test('should get top nodes', async () => {
    const topNodes = await analytics.getTopNodes(5);
    expect(Array.isArray(topNodes)).toBe(true);
  });

  test('should get geographic stats', async () => {
    const geoStats = await analytics.getGeographicStats();
    expect(Array.isArray(geoStats)).toBe(true);
  });

  test('should get error stats', async () => {
    const errorStats = await analytics.getErrorStats();
    expect(Array.isArray(errorStats)).toBe(true);
  });

  test('should export data as JSON', async () => {
    const exported = await analytics.exportData('json');
    const parsed = JSON.parse(exported);
    
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed).toHaveProperty('stats');
    expect(parsed).toHaveProperty('hourly');
    expect(parsed).toHaveProperty('topNodes');
    expect(parsed).toHaveProperty('geographic');
    expect(parsed).toHaveProperty('errors');
  });

  test('should export data as CSV', async () => {
    const csv = await analytics.exportData('csv');
    expect(typeof csv).toBe('string');
    expect(csv).toContain('Type,Value');
  });

  test('toCSV should convert data properly', () => {
    const data = {
      stats: { totalRequests: 1000, errors: 5 }
    };
    const csv = analytics.toCSV(data);
    expect(csv).toContain('Total Requests,1000');
    expect(csv).toContain('Errors,5');
  });
});
