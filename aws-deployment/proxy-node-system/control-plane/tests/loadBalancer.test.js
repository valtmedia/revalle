const LoadBalancer = require('../src/loadBalancer');
const NodeManager = require('../src/nodeManager');

describe('LoadBalancer', () => {
  let loadBalancer;
  let nodeManager;

  beforeAll(() => {
    nodeManager = new NodeManager();
    loadBalancer = new LoadBalancer(nodeManager);
  });

  test('should get next node with round-robin', async () => {
    await nodeManager.registerNode({ name: 'node1', host: '1.1.1.1', port: 3128 });
    await nodeManager.registerNode({ name: 'node2', host: '2.2.2.2', port: 3128 });

    const node1 = await loadBalancer.getNextNode({ strategy: 'round-robin' });
    const node2 = await loadBalancer.getNextNode({ strategy: 'round-robin' });
    const node3 = await loadBalancer.getNextNode({ strategy: 'round-robin' });

    expect(node1.id).toBe(node3.id); // Should cycle back
  });

  test('should get least loaded node', async () => {
    const node1 = await nodeManager.registerNode({ 
      name: 'low-load', 
      host: '3.3.3.3', 
      port: 3128,
      capacity: 1000
    });
    const node2 = await nodeManager.registerNode({ 
      name: 'high-load', 
      host: '4.4.4.4', 
      port: 3128,
      capacity: 1000
    });

    await nodeManager.updateHeartbeat(node2.id, { load: 800 });

    const selected = await loadBalancer.getNextNode({ strategy: 'least-connections' });
    expect(selected.id).toBe(node1.id);
  });
});
