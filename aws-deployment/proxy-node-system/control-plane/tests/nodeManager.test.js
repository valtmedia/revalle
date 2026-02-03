const NodeManager = require('../src/nodeManager');

describe('NodeManager', () => {
  let nodeManager;

  beforeAll(() => {
    nodeManager = new NodeManager();
  });

  test('should register a node', async () => {
    const nodeData = {
      name: 'test-node',
      host: '1.2.3.4',
      port: 3128,
      region: 'us-east-1'
    };

    const node = await nodeManager.registerNode(nodeData);
    expect(node).toHaveProperty('id');
    expect(node.host).toBe(nodeData.host);
    expect(node.status).toBe('active');
  });

  test('should get registered node', async () => {
    const nodeData = {
      name: 'test-node-2',
      host: '5.6.7.8',
      port: 3128
    };

    const registered = await nodeManager.registerNode(nodeData);
    const retrieved = await nodeManager.getNode(registered.id);
    
    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(registered.id);
  });

  test('should update node heartbeat', async () => {
    const node = await nodeManager.registerNode({
      name: 'heartbeat-test',
      host: '9.10.11.12',
      port: 3128
    });

    const updated = await nodeManager.updateHeartbeat(node.id, {
      load: 50,
      health: 'healthy'
    });

    expect(updated.currentLoad).toBe(50);
    expect(updated.health).toBe('healthy');
  });
});
