const UserManager = require('../src/userManager');

// Mock Redis for testing
jest.mock('redis', () => {
  const store = new Map();
  return {
    createClient: () => ({
      connect: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockImplementation(key => store.get(key) || null),
      set: jest.fn().mockImplementation((key, val) => { store.set(key, val); }),
      setEx: jest.fn().mockImplementation((key, ttl, val) => { store.set(key, val); }),
      del: jest.fn().mockImplementation(key => { store.delete(key); }),
      keys: jest.fn().mockImplementation(pattern => {
        const prefix = pattern.replace('*', '');
        return [...store.keys()].filter(k => k.startsWith(prefix));
      }),
      sAdd: jest.fn(),
      sRem: jest.fn(),
      sMembers: jest.fn().mockResolvedValue([]),
      incr: jest.fn().mockImplementation(key => {
        const val = parseInt(store.get(key) || '0') + 1;
        store.set(key, val.toString());
        return val;
      })
    })
  };
});

describe('UserManager', () => {
  let userManager;

  beforeAll(() => {
    userManager = new UserManager();
  });

  test('should create a user with hashed password', async () => {
    const user = await userManager.createUser({
      username: 'testuser',
      password: 'testpassword123',
      email: 'test@example.com'
    });

    expect(user).toHaveProperty('id');
    expect(user.username).toBe('testuser');
    expect(user.email).toBe('test@example.com');
    expect(user.password).toBeUndefined(); // Should not return password
    expect(user.role).toBe('user');
    expect(user.status).toBe('active');
  });

  test('should create user with custom role and quota', async () => {
    const user = await userManager.createUser({
      username: 'admin2',
      password: 'adminpass123',
      role: 'admin',
      quota: {
        requests: 50000,
        bandwidth: 53687091200, // 50GB
        period: 'monthly'
      }
    });

    expect(user.role).toBe('admin');
    expect(user.quota.requests).toBe(50000);
    expect(user.quota.bandwidth).toBe(53687091200);
  });

  test('should have default quota for new users', async () => {
    const user = await userManager.createUser({
      username: 'defaultuser',
      password: 'password123'
    });

    expect(user.quota).toBeDefined();
    expect(user.quota.requests).toBe(10000);
    expect(user.quota.bandwidth).toBe(10737418240); // 10GB
    expect(user.quota.period).toBe('monthly');
  });

  test('should have usage tracking initialized at zero', async () => {
    const user = await userManager.createUser({
      username: 'usageuser',
      password: 'password123'
    });

    expect(user.usage).toBeDefined();
    expect(user.usage.requests).toBe(0);
    expect(user.usage.bandwidth).toBe(0);
  });

  test('should generate unique user IDs', async () => {
    const user1 = await userManager.createUser({ username: 'u1', password: 'pass12345' });
    const user2 = await userManager.createUser({ username: 'u2', password: 'pass12345' });

    expect(user1.id).not.toBe(user2.id);
  });

  test('getNextResetDate should calculate correctly for daily period', () => {
    const resetDate = new Date(userManager.getNextResetDate('daily'));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    expect(resetDate.getDate()).toBe(tomorrow.getDate());
  });

  test('getNextResetDate should calculate correctly for weekly period', () => {
    const resetDate = new Date(userManager.getNextResetDate('weekly'));
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    expect(resetDate.getDate()).toBe(nextWeek.getDate());
  });

  test('getNextResetDate should calculate correctly for monthly period', () => {
    const resetDate = new Date(userManager.getNextResetDate('monthly'));
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    
    expect(resetDate.getMonth()).toBe(nextMonth.getMonth());
  });

  test('isQuotaExceeded should return false for new user', () => {
    const user = {
      quota: { requests: 10000, bandwidth: 10737418240, period: 'monthly' },
      usage: { requests: 0, bandwidth: 0, resetAt: new Date(Date.now() + 86400000).toISOString() }
    };

    expect(userManager.isQuotaExceeded(user)).toBe(false);
  });

  test('isQuotaExceeded should return true when requests exceeded', () => {
    const user = {
      quota: { requests: 100, bandwidth: 10737418240, period: 'monthly' },
      usage: { requests: 100, bandwidth: 0, resetAt: new Date(Date.now() + 86400000).toISOString() }
    };

    expect(userManager.isQuotaExceeded(user)).toBe(true);
  });

  test('isQuotaExceeded should return true when bandwidth exceeded', () => {
    const user = {
      quota: { requests: 10000, bandwidth: 1024, period: 'monthly' },
      usage: { requests: 0, bandwidth: 1024, resetAt: new Date(Date.now() + 86400000).toISOString() }
    };

    expect(userManager.isQuotaExceeded(user)).toBe(true);
  });
});
