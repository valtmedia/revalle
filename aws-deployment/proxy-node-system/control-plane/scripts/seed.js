#!/usr/bin/env node
'use strict';

/**
 * Database Seeder
 * Seeds the database with test data for development
 */

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

async function main() {
  console.log('=== Database Seeder ===');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'proxy_system',
    multipleStatements: true
  });

  try {
    // Seed admin user
    const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
    await connection.execute(`
      INSERT INTO users (id, username, password_hash, email, role, status, quota_requests, quota_bandwidth)
      VALUES ('usr-admin-001', 'admin', ?, 'admin@proxy-system.local', 'admin', 'active', 999999, 107374182400)
      ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)
    `, [adminPassword]);
    console.log('  ✓ Admin user seeded');

    // Seed test users
    const testPassword = await bcrypt.hash('testpass123', 10);
    const testUsers = [
      ['usr-test-001', 'testuser1', testPassword, 'test1@example.com', 'user'],
      ['usr-test-002', 'testuser2', testPassword, 'test2@example.com', 'user'],
      ['usr-test-003', 'readonly1', testPassword, 'readonly@example.com', 'readonly'],
      ['usr-test-004', 'apiuser1', testPassword, 'api@example.com', 'api']
    ];

    for (const [id, username, hash, email, role] of testUsers) {
      await connection.execute(`
        INSERT INTO users (id, username, password_hash, email, role, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON DUPLICATE KEY UPDATE id = id
      `, [id, username, hash, email, role]);
    }
    console.log(`  ✓ ${testUsers.length} test users seeded`);

    // Seed sample proxy nodes
    const nodes = [
      ['node-us-east-1', 'US East Node 1', '10.0.1.10', 3128, 'us-east-1'],
      ['node-us-west-1', 'US West Node 1', '10.0.2.10', 3128, 'us-west-2'],
      ['node-eu-west-1', 'EU West Node 1', '10.0.3.10', 3128, 'eu-west-1'],
      ['node-ap-east-1', 'APAC Node 1', '10.0.4.10', 3128, 'ap-northeast-1']
    ];

    for (const [id, name, host, port, region] of nodes) {
      await connection.execute(`
        INSERT INTO proxy_nodes (id, name, host, port, region, status, health)
        VALUES (?, ?, ?, ?, ?, 'active', 'healthy')
        ON DUPLICATE KEY UPDATE id = id
      `, [id, name, host, port, region]);
    }
    console.log(`  ✓ ${nodes.length} proxy nodes seeded`);

    // Seed sample alerts
    await connection.execute(`
      INSERT INTO alerts (severity, type, message, node_id)
      VALUES 
        ('info', 'system', 'System initialized successfully', NULL),
        ('warning', 'node_load', 'Node load above 80%', 'node-us-east-1'),
        ('critical', 'node_down', 'Node unreachable', 'node-ap-east-1')
      ON DUPLICATE KEY UPDATE id = id
    `);
    console.log('  ✓ Sample alerts seeded');

    // Seed default configurations
    const configs = [
      ['system.proxy.default_port', '3128', 'Default proxy port', 'proxy'],
      ['system.proxy.max_connections', '1000', 'Max connections per node', 'proxy'],
      ['system.auth.session_ttl', '3600', 'Session TTL (seconds)', 'auth'],
      ['system.monitoring.heartbeat_interval', '30', 'Heartbeat interval (seconds)', 'monitoring']
    ];

    for (const [key, value, desc, category] of configs) {
      await connection.execute(`
        INSERT INTO configurations (config_key, config_value, description, category)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
      `, [key, value, desc, category]);
    }
    console.log(`  ✓ ${configs.length} configurations seeded`);

    console.log('\nSeeding complete!');
  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
