const Database = require('../src/database');
const path = require('path');
const fs = require('fs').promises;

describe('Database', () => {
  let db;
  const testDataDir = path.join(__dirname, 'test-data');

  beforeAll(async () => {
    db = new Database({ dataDir: testDataDir, flushInterval: 100 });
    await db.initialize();
  });

  afterAll(async () => {
    await db.shutdown();
    try {
      await fs.rm(testDataDir, { recursive: true });
    } catch {}
  });

  test('should initialize database', () => {
    expect(db.initialized).toBe(true);
  });

  test('should insert and retrieve a document', async () => {
    const doc = await db.insert('test_collection', {
      name: 'Test Document',
      value: 42
    });

    expect(doc._id).toBeDefined();
    expect(doc.name).toBe('Test Document');
    expect(doc.value).toBe(42);
    expect(doc._createdAt).toBeDefined();
    expect(doc._updatedAt).toBeDefined();

    const retrieved = await db.findById('test_collection', doc._id);
    expect(retrieved.name).toBe('Test Document');
  });

  test('should insert multiple documents', async () => {
    const docs = await db.insertMany('test_collection', [
      { name: 'Doc A', priority: 1 },
      { name: 'Doc B', priority: 2 },
      { name: 'Doc C', priority: 3 }
    ]);

    expect(docs.length).toBe(3);
    expect(docs[0].name).toBe('Doc A');
    expect(docs[2].name).toBe('Doc C');
  });

  test('should find documents with query', async () => {
    await db.insert('users_test', { name: 'Alice', age: 30, role: 'admin' });
    await db.insert('users_test', { name: 'Bob', age: 25, role: 'user' });
    await db.insert('users_test', { name: 'Charlie', age: 35, role: 'admin' });

    const admins = await db.find('users_test', { role: 'admin' });
    expect(admins.length).toBe(2);

    const bob = await db.findOne('users_test', { name: 'Bob' });
    expect(bob.age).toBe(25);
  });

  test('should support comparison operators', async () => {
    await db.insert('numbers', { value: 10 });
    await db.insert('numbers', { value: 20 });
    await db.insert('numbers', { value: 30 });
    await db.insert('numbers', { value: 40 });

    const gt20 = await db.find('numbers', { value: { $gt: 20 } });
    expect(gt20.length).toBe(2);

    const gte20 = await db.find('numbers', { value: { $gte: 20 } });
    expect(gte20.length).toBe(3);

    const lt30 = await db.find('numbers', { value: { $lt: 30 } });
    expect(lt30.length).toBe(2);

    const inRange = await db.find('numbers', { value: { $in: [10, 30] } });
    expect(inRange.length).toBe(2);
  });

  test('should support sorting', async () => {
    const sorted = await db.find('numbers', {}, { sort: { value: -1 } });
    expect(sorted[0].value).toBe(40);
    expect(sorted[sorted.length - 1].value).toBe(10);
  });

  test('should support pagination', async () => {
    const page1 = await db.find('numbers', {}, { skip: 0, limit: 2, sort: { value: 1 } });
    expect(page1.length).toBe(2);
    expect(page1[0].value).toBe(10);

    const page2 = await db.find('numbers', {}, { skip: 2, limit: 2, sort: { value: 1 } });
    expect(page2.length).toBe(2);
    expect(page2[0].value).toBe(30);
  });

  test('should update a document', async () => {
    const doc = await db.insert('update_test', { name: 'Original', count: 0 });
    
    const updated = await db.update('update_test', doc._id, { name: 'Updated' });
    expect(updated.name).toBe('Updated');
    expect(updated._updatedAt).not.toBe(doc._updatedAt);
  });

  test('should support $inc operator', async () => {
    const doc = await db.insert('inc_test', { name: 'Counter', count: 5 });
    
    await db.update('inc_test', doc._id, { $inc: { count: 3 } });
    const updated = await db.findById('inc_test', doc._id);
    expect(updated.count).toBe(8);
  });

  test('should support $set operator', async () => {
    const doc = await db.insert('set_test', { name: 'Old', status: 'active' });
    
    await db.update('set_test', doc._id, { $set: { status: 'inactive', reason: 'test' } });
    const updated = await db.findById('set_test', doc._id);
    expect(updated.status).toBe('inactive');
    expect(updated.reason).toBe('test');
  });

  test('should delete a document', async () => {
    const doc = await db.insert('delete_test', { name: 'To Delete' });
    
    const deleted = await db.delete('delete_test', doc._id);
    expect(deleted).toBe(true);
    
    const retrieved = await db.findById('delete_test', doc._id);
    expect(retrieved).toBeNull();
  });

  test('should count documents', async () => {
    await db.insert('count_test', { type: 'a' });
    await db.insert('count_test', { type: 'b' });
    await db.insert('count_test', { type: 'a' });

    const total = await db.count('count_test');
    expect(total).toBe(3);

    const typeA = await db.count('count_test', { type: 'a' });
    expect(typeA).toBe(2);
  });

  test('should aggregate with $group', async () => {
    await db.insert('agg_test', { category: 'A', amount: 10 });
    await db.insert('agg_test', { category: 'A', amount: 20 });
    await db.insert('agg_test', { category: 'B', amount: 30 });

    const result = await db.aggregate('agg_test', [
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $count: true } } }
    ]);

    expect(result.length).toBe(2);
    const groupA = result.find(r => r._id === 'A');
    expect(groupA.total).toBe(30);
    expect(groupA.count).toBe(2);
  });

  test('should create and use indexes', async () => {
    await db.insert('index_test', { email: 'a@test.com', name: 'Alice' });
    await db.insert('index_test', { email: 'b@test.com', name: 'Bob' });

    const index = await db.createIndex('index_test', 'email');
    expect(index.field).toBe('email');
    expect(index.data.size).toBe(2);
  });

  test('should support transactions', async () => {
    const tx = db.beginTransaction();
    
    await tx.insert('tx_test', { name: 'Doc1' });
    await tx.insert('tx_test', { name: 'Doc2' });
    
    const result = await tx.commit();
    expect(result.committed).toBe(true);
    expect(result.operations).toBe(2);
    
    const count = await db.count('tx_test');
    expect(count).toBe(2);
  });

  test('should rollback transactions', async () => {
    const initialCount = await db.count('rollback_test');
    
    const tx = db.beginTransaction();
    await tx.insert('rollback_test', { name: 'Should not exist' });
    
    await tx.rollback();
    
    const afterCount = await db.count('rollback_test');
    expect(afterCount).toBe(initialCount);
  });

  test('should get database stats', () => {
    const stats = db.getStats();
    expect(stats.initialized).toBe(true);
    expect(stats.totalDocuments).toBeGreaterThan(0);
    expect(stats.collections).toBeDefined();
  });

  test('should export and import data', async () => {
    const exported = await db.exportAll();
    expect(typeof exported).toBe('object');
    expect(Object.keys(exported).length).toBeGreaterThan(0);
  });
});
