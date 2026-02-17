#!/usr/bin/env node
'use strict';

/**
 * Database Migration Runner
 * Runs SQL migration files in order against the MySQL database
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  console.log('=== Database Migration Runner ===');
  console.log(`Migrations directory: ${MIGRATIONS_DIR}`);

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'proxy_system',
    multipleStatements: true
  });

  try {
    // Create migrations tracking table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already applied migrations
    const [applied] = await connection.execute('SELECT filename FROM _migrations ORDER BY id');
    const appliedFiles = new Set(applied.map(r => r.filename));

    // Get migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files`);
    console.log(`Already applied: ${appliedFiles.size}`);

    let migrationsRun = 0;
    for (const file of files) {
      if (appliedFiles.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      console.log(`  → Running ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await connection.query(sql);
        await connection.execute('INSERT INTO _migrations (filename) VALUES (?)', [file]);
        console.log(`  ✓ ${file} (applied)`);
        migrationsRun++;
      } catch (error) {
        console.error(`  ✗ ${file} FAILED: ${error.message}`);
        process.exit(1);
      }
    }

    console.log(`\nDone! ${migrationsRun} migration(s) applied.`);
  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
