#!/usr/bin/env node

const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const API_URL = process.env.PROXY_API_URL || 'http://localhost:3000';
const CONFIG_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.proxy-cli.json');

class ProxyCLI {
  constructor() {
    this.token = this.loadToken();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  loadToken() {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return config.token;
    } catch {
      return null;
    }
  }

  saveToken(token) {
    const config = { token, apiUrl: API_URL };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  async request(method, endpoint, data = null) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await axios({
        method,
        url: `${API_URL}${endpoint}`,
        headers,
        data
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(error.response.data.error || error.message);
      }
      throw error;
    }
  }

  async login(username, password) {
    const result = await this.request('POST', '/api/users/auth', { username, password });
    this.token = result.token;
    this.saveToken(this.token);
    console.log('✓ Logged in successfully');
    return result;
  }

  async listNodes() {
    const result = await this.request('GET', '/api/nodes');
    console.table(result.nodes.map(n => ({
      ID: n.id,
      Name: n.name,
      Host: `${n.host}:${n.port}`,
      Status: n.status,
      Health: n.health,
      Load: `${n.currentLoad}/${n.capacity}`,
      Region: n.region
    })));
    return result;
  }

  async getNode(nodeId) {
    const result = await this.request('GET', `/api/nodes/${nodeId}`);
    console.log(JSON.stringify(result.node, null, 2));
    return result;
  }

  async getStats() {
    const result = await this.request('GET', '/api/stats/overview');
    console.log('=== System Statistics ===');
    console.log(`Total Nodes: ${result.stats.totalNodes}`);
    console.log(`Active Nodes: ${result.stats.activeNodes}`);
    console.log(`Total Requests: ${result.stats.totalRequests.toLocaleString()}`);
    console.log(`Bandwidth Used: ${(result.stats.bandwidthUsed / 1024 / 1024 / 1024).toFixed(2)} GB`);
    console.log(`Uptime: ${(result.stats.uptime / 3600).toFixed(2)} hours`);
    return result;
  }

  async getNextNode() {
    const result = await this.request('GET', '/api/load-balancer/next-node');
    console.log(`Next available node: ${result.node.host}:${result.node.port}`);
    return result;
  }

  async createUser(userData) {
    const result = await this.request('POST', '/api/users', userData);
    console.log('✓ User created:', result.user.username);
    return result;
  }

  async listUsers() {
    const result = await this.request('GET', '/api/users');
    console.table(result.users.map(u => ({
      ID: u.id,
      Username: u.username,
      Email: u.email || 'N/A',
      Role: u.role,
      Status: u.status
    })));
    return result;
  }

  async getAnalytics(range = '24h') {
    const result = await this.request('GET', `/api/analytics/stats?range=${range}`);
    console.log('=== Analytics ===');
    console.log(JSON.stringify(result.stats, null, 2));
    return result;
  }

  async createBackup() {
    const result = await this.request('POST', '/api/backup/create');
    console.log('✓ Backup created:', result.backup.filename);
    return result;
  }

  async listBackups() {
    const result = await this.request('GET', '/api/backup/list');
    console.table(result.backups.map(b => ({
      Filename: b.filename,
      Size: `${(b.size / 1024).toFixed(2)} KB`,
      Created: new Date(b.createdAt).toLocaleString()
    })));
    return result;
  }

  showHelp() {
    console.log(`
Proxy Node Management CLI

Commands:
  login <username> <password>    - Login to API
  nodes                          - List all nodes
  node <id>                      - Get node details
  stats                          - Show system statistics
  next-node                      - Get next available node
  users                          - List all users
  create-user <data>             - Create new user
  analytics [range]              - Get analytics (1h|24h|7d|30d)
  backup create                  - Create backup
  backup list                    - List backups
  help                           - Show this help
    `);
  }

  async run() {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
      switch (command) {
        case 'login':
          await this.login(args[1], args[2]);
          break;
        case 'nodes':
          await this.listNodes();
          break;
        case 'node':
          await this.getNode(args[1]);
          break;
        case 'stats':
          await this.getStats();
          break;
        case 'next-node':
          await this.getNextNode();
          break;
        case 'users':
          await this.listUsers();
          break;
        case 'create-user':
          await this.createUser(JSON.parse(args[1]));
          break;
        case 'analytics':
          await this.getAnalytics(args[1]);
          break;
        case 'backup':
          if (args[1] === 'create') {
            await this.createBackup();
          } else if (args[1] === 'list') {
            await this.listBackups();
          }
          break;
        case 'help':
        default:
          this.showHelp();
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }

    this.rl.close();
  }
}

const cli = new ProxyCLI();
cli.run();
