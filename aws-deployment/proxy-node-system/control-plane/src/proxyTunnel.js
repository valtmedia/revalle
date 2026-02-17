const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');
const { EventEmitter } = require('events');
const { logger } = require('./logger');
const metrics = require('./prometheusMetrics');

/**
 * Proxy Tunnel Manager
 * Handles HTTP/HTTPS proxy connections through proxy nodes
 * Supports CONNECT tunneling for HTTPS, connection pooling, and failover
 */
class ProxyTunnel extends EventEmitter {
  constructor(loadBalancer, options = {}) {
    super();
    this.loadBalancer = loadBalancer;
    this.options = {
      timeout: options.timeout || 30000,
      retries: options.retries || 3,
      retryDelay: options.retryDelay || 1000,
      maxConnectionsPerNode: options.maxConnectionsPerNode || 100,
      keepAliveTimeout: options.keepAliveTimeout || 60000,
      ...options
    };
    
    this.connectionPools = new Map(); // nodeId -> ConnectionPool
    this.activeConnections = new Map();
    this.connectionStats = {
      totalCreated: 0,
      totalClosed: 0,
      totalErrors: 0,
      totalRequests: 0,
      totalBytesIn: 0,
      totalBytesOut: 0
    };
    
    // Start connection cleanup interval
    this._cleanupInterval = setInterval(() => this._cleanupConnections(), 30000);
  }

  /**
   * Forward an HTTP request through a proxy node
   */
  async forwardHTTP(targetUrl, options = {}) {
    const startTime = Date.now();
    let lastError = null;
    
    for (let attempt = 0; attempt < this.options.retries; attempt++) {
      try {
        const node = await this.loadBalancer.getNextNode(options);
        if (!node) {
          throw new Error('No available proxy nodes');
        }
        
        const result = await this._makeHTTPRequest(node, targetUrl, options);
        
        const duration = Date.now() - startTime;
        this.connectionStats.totalRequests++;
        
        metrics.inc('proxy_requests_total', {
          region: node.region || 'unknown',
          protocol: 'http'
        });
        metrics.observe('proxy_latency_seconds', duration / 1000, {
          region: node.region || 'unknown'
        });
        
        this.emit('request:success', { node, targetUrl, duration, attempt });
        return result;
        
      } catch (error) {
        lastError = error;
        logger.warn(`Proxy request attempt ${attempt + 1} failed`, {
          targetUrl,
          error: error.message,
          attempt: attempt + 1
        });
        
        if (attempt < this.options.retries - 1) {
          await this._delay(this.options.retryDelay * (attempt + 1));
        }
      }
    }
    
    this.connectionStats.totalErrors++;
    metrics.inc('proxy_errors_total', {
      error_type: 'request_failed',
      region: 'unknown'
    });
    
    this.emit('request:failed', { targetUrl, error: lastError });
    throw lastError;
  }

  /**
   * Create a CONNECT tunnel for HTTPS through a proxy node
   */
  async createTunnel(targetHost, targetPort, options = {}) {
    const node = await this.loadBalancer.getNextNode(options);
    if (!node) {
      throw new Error('No available proxy nodes for tunnel');
    }
    
    return new Promise((resolve, reject) => {
      const connectReq = http.request({
        host: node.host,
        port: node.port,
        method: 'CONNECT',
        path: `${targetHost}:${targetPort}`,
        timeout: this.options.timeout,
        headers: {
          'Host': `${targetHost}:${targetPort}`,
          'Proxy-Connection': 'Keep-Alive',
          ...(options.auth ? {
            'Proxy-Authorization': 'Basic ' + Buffer.from(options.auth).toString('base64')
          } : {})
        }
      });
      
      connectReq.on('connect', (res, socket, head) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          reject(new Error(`Tunnel failed with status ${res.statusCode}`));
          return;
        }
        
        const tunnelId = this._generateId();
        this.activeConnections.set(tunnelId, {
          id: tunnelId,
          node,
          targetHost,
          targetPort,
          socket,
          createdAt: Date.now(),
          bytesIn: 0,
          bytesOut: 0
        });
        
        this.connectionStats.totalCreated++;
        metrics.gaugeInc('proxy_connections_active');
        
        // Track bytes
        socket.on('data', (chunk) => {
          const conn = this.activeConnections.get(tunnelId);
          if (conn) {
            conn.bytesIn += chunk.length;
            this.connectionStats.totalBytesIn += chunk.length;
          }
        });
        
        socket.on('close', () => {
          this.activeConnections.delete(tunnelId);
          this.connectionStats.totalClosed++;
          metrics.gaugeDec('proxy_connections_active');
        });
        
        socket.on('error', (err) => {
          logger.error('Tunnel socket error', { tunnelId, error: err.message });
          this.activeConnections.delete(tunnelId);
          this.connectionStats.totalErrors++;
          metrics.gaugeDec('proxy_connections_active');
        });
        
        this.emit('tunnel:created', { tunnelId, node, targetHost, targetPort });
        resolve({ tunnelId, socket, node });
      });
      
      connectReq.on('error', (err) => {
        metrics.inc('proxy_errors_total', {
          error_type: 'tunnel_failed',
          region: node.region || 'unknown'
        });
        reject(new Error(`Failed to create tunnel: ${err.message}`));
      });
      
      connectReq.on('timeout', () => {
        connectReq.destroy();
        reject(new Error('Tunnel connection timed out'));
      });
      
      connectReq.end();
    });
  }

  /**
   * Create a proxy chain (multi-hop)
   */
  async createChain(hops, targetHost, targetPort) {
    if (hops.length === 0) {
      throw new Error('At least one hop is required');
    }
    
    logger.info(`Creating proxy chain with ${hops.length} hops to ${targetHost}:${targetPort}`);
    
    let currentSocket = null;
    
    for (let i = 0; i < hops.length; i++) {
      const hop = hops[i];
      const nextTarget = i < hops.length - 1 
        ? { host: hops[i + 1].host, port: hops[i + 1].port }
        : { host: targetHost, port: targetPort };
      
      if (currentSocket) {
        // Use existing socket for next CONNECT
        currentSocket = await this._tunnelThroughSocket(
          currentSocket, 
          hop, 
          nextTarget.host, 
          nextTarget.port
        );
      } else {
        // First hop - direct CONNECT
        const result = await this.createTunnel(
          nextTarget.host, 
          nextTarget.port, 
          { node: hop }
        );
        currentSocket = result.socket;
      }
    }
    
    return currentSocket;
  }

  /**
   * Get connection pool for a node
   */
  getPool(nodeId) {
    if (!this.connectionPools.has(nodeId)) {
      this.connectionPools.set(nodeId, {
        nodeId,
        connections: [],
        maxSize: this.options.maxConnectionsPerNode,
        created: 0,
        reused: 0,
        active: 0
      });
    }
    return this.connectionPools.get(nodeId);
  }

  /**
   * Get a connection from the pool or create a new one
   */
  async getConnection(node) {
    const pool = this.getPool(node.id);
    
    // Try to find a reusable connection
    const availableIdx = pool.connections.findIndex(c => 
      !c.inUse && !c.socket.destroyed && 
      Date.now() - c.lastUsed < this.options.keepAliveTimeout
    );
    
    if (availableIdx >= 0) {
      const conn = pool.connections[availableIdx];
      conn.inUse = true;
      conn.lastUsed = Date.now();
      pool.reused++;
      return conn;
    }
    
    // Create new connection
    if (pool.active >= pool.maxSize) {
      throw new Error(`Connection pool exhausted for node ${node.id}`);
    }
    
    const socket = net.createConnection({
      host: node.host,
      port: node.port,
      timeout: this.options.timeout
    });
    
    const conn = {
      id: this._generateId(),
      socket,
      node,
      inUse: true,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };
    
    pool.connections.push(conn);
    pool.created++;
    pool.active++;
    
    socket.on('close', () => {
      pool.active--;
      const idx = pool.connections.indexOf(conn);
      if (idx >= 0) pool.connections.splice(idx, 1);
    });
    
    socket.on('error', (err) => {
      logger.error('Pool connection error', { nodeId: node.id, error: err.message });
    });
    
    return conn;
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(conn) {
    conn.inUse = false;
    conn.lastUsed = Date.now();
  }

  /**
   * Get tunnel statistics
   */
  getStats() {
    const pools = {};
    for (const [nodeId, pool] of this.connectionPools) {
      pools[nodeId] = {
        active: pool.active,
        totalCreated: pool.created,
        totalReused: pool.reused,
        poolSize: pool.connections.length
      };
    }
    
    return {
      ...this.connectionStats,
      activeConnections: this.activeConnections.size,
      pools,
      uptime: Date.now() - (this._startTime || Date.now())
    };
  }

  /**
   * Get active tunnels
   */
  getActiveTunnels() {
    const tunnels = [];
    for (const [id, conn] of this.activeConnections) {
      tunnels.push({
        id,
        nodeId: conn.node.id,
        nodeHost: conn.node.host,
        targetHost: conn.targetHost,
        targetPort: conn.targetPort,
        createdAt: new Date(conn.createdAt).toISOString(),
        duration: Date.now() - conn.createdAt,
        bytesIn: conn.bytesIn,
        bytesOut: conn.bytesOut
      });
    }
    return tunnels;
  }

  /**
   * Close a specific tunnel
   */
  closeTunnel(tunnelId) {
    const conn = this.activeConnections.get(tunnelId);
    if (conn) {
      conn.socket.destroy();
      this.activeConnections.delete(tunnelId);
      this.emit('tunnel:closed', { tunnelId });
      return true;
    }
    return false;
  }

  /**
   * Close all tunnels
   */
  closeAllTunnels() {
    for (const [id, conn] of this.activeConnections) {
      conn.socket.destroy();
    }
    this.activeConnections.clear();
    this.emit('tunnels:closed-all');
  }

  /**
   * Shutdown - close all connections and pools
   */
  shutdown() {
    clearInterval(this._cleanupInterval);
    this.closeAllTunnels();
    
    for (const pool of this.connectionPools.values()) {
      for (const conn of pool.connections) {
        conn.socket.destroy();
      }
      pool.connections = [];
    }
    this.connectionPools.clear();
  }

  // Private methods

  async _makeHTTPRequest(node, targetUrl, options = {}) {
    return new Promise((resolve, reject) => {
      const parsed = url.parse(targetUrl);
      
      const reqOptions = {
        host: node.host,
        port: node.port,
        path: targetUrl,
        method: options.method || 'GET',
        headers: {
          'Host': parsed.host,
          'User-Agent': options.userAgent || 'ProxyNodeSystem/1.0',
          ...(options.headers || {}),
          ...(options.auth ? {
            'Proxy-Authorization': 'Basic ' + Buffer.from(options.auth).toString('base64')
          } : {})
        },
        timeout: this.options.timeout
      };
      
      const req = http.request(reqOptions, (res) => {
        const chunks = [];
        let totalSize = 0;
        
        res.on('data', (chunk) => {
          chunks.push(chunk);
          totalSize += chunk.length;
          this.connectionStats.totalBytesIn += chunk.length;
          metrics.inc('proxy_bytes_total', { direction: 'in' }, chunk.length);
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            size: totalSize,
            node: { id: node.id, host: node.host, port: node.port }
          });
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
      
      if (options.body) {
        const bodyData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        this.connectionStats.totalBytesOut += bodyData.length;
        metrics.inc('proxy_bytes_total', { direction: 'out' }, bodyData.length);
        req.write(bodyData);
      }
      
      req.end();
    });
  }

  async _tunnelThroughSocket(socket, hop, targetHost, targetPort) {
    return new Promise((resolve, reject) => {
      const connectLine = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`;
      
      socket.write(connectLine);
      
      socket.once('data', (data) => {
        const response = data.toString();
        if (response.includes('200')) {
          resolve(socket);
        } else {
          reject(new Error(`Chain hop failed: ${response.split('\r\n')[0]}`));
        }
      });
      
      socket.once('error', reject);
    });
  }

  _cleanupConnections() {
    const now = Date.now();
    
    for (const pool of this.connectionPools.values()) {
      pool.connections = pool.connections.filter(conn => {
        if (!conn.inUse && (now - conn.lastUsed > this.options.keepAliveTimeout || conn.socket.destroyed)) {
          conn.socket.destroy();
          pool.active--;
          return false;
        }
        return true;
      });
    }
    
    // Clean up dead active connections
    for (const [id, conn] of this.activeConnections) {
      if (conn.socket.destroyed) {
        this.activeConnections.delete(id);
      }
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _generateId() {
    return `tunnel-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
  }
}

module.exports = ProxyTunnel;
