-- ===========================================
-- Database Initialization Script
-- Proxy Node System
-- ===========================================

CREATE DATABASE IF NOT EXISTS proxy_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE proxy_system;

-- ===========================================
-- Sessions Table
-- ===========================================
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB;

-- ===========================================
-- Audit Logs Table
-- ===========================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    details JSON,
    ip_address VARCHAR(45),
    success BOOLEAN DEFAULT TRUE,
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    INDEX idx_timestamp (timestamp),
    INDEX idx_resource (resource_type, resource_id)
) ENGINE=InnoDB;

-- ===========================================
-- Proxy Nodes Table
-- ===========================================
CREATE TABLE IF NOT EXISTS proxy_nodes (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,
    local_ip VARCHAR(45),
    port INT NOT NULL DEFAULT 3128,
    region VARCHAR(100),
    status ENUM('active', 'inactive', 'draining', 'maintenance') DEFAULT 'active',
    health ENUM('healthy', 'unhealthy', 'degraded', 'unknown') DEFAULT 'unknown',
    current_load INT DEFAULT 0,
    capacity INT DEFAULT 1000,
    version VARCHAR(50),
    capabilities JSON,
    resources JSON,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_health (health),
    INDEX idx_region (region),
    INDEX idx_last_heartbeat (last_heartbeat)
) ENGINE=InnoDB;

-- ===========================================
-- Users Table
-- ===========================================
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role ENUM('admin', 'user', 'readonly', 'api') DEFAULT 'user',
    status ENUM('active', 'suspended', 'deleted') DEFAULT 'active',
    quota_requests INT DEFAULT 10000,
    quota_bandwidth BIGINT DEFAULT 10737418240,
    quota_period ENUM('daily', 'weekly', 'monthly') DEFAULT 'monthly',
    usage_requests INT DEFAULT 0,
    usage_bandwidth BIGINT DEFAULT 0,
    usage_reset_at DATETIME,
    api_key VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login DATETIME,
    INDEX idx_username (username),
    INDEX idx_api_key (api_key),
    INDEX idx_status (status)
) ENGINE=InnoDB;

-- ===========================================
-- Access Logs Table (for analytics)
-- ===========================================
CREATE TABLE IF NOT EXISTS access_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    node_id VARCHAR(255),
    user_id VARCHAR(255),
    client_ip VARCHAR(45),
    method VARCHAR(10),
    url TEXT,
    status_code INT,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    response_time_ms INT,
    cache_result VARCHAR(50),
    user_agent TEXT,
    INDEX idx_timestamp (timestamp),
    INDEX idx_node_id (node_id),
    INDEX idx_user_id (user_id),
    INDEX idx_status_code (status_code)
) ENGINE=InnoDB
PARTITION BY RANGE (YEAR(timestamp) * 100 + MONTH(timestamp)) (
    PARTITION p202401 VALUES LESS THAN (202402),
    PARTITION p202402 VALUES LESS THAN (202403),
    PARTITION p202403 VALUES LESS THAN (202404),
    PARTITION p202404 VALUES LESS THAN (202405),
    PARTITION p202405 VALUES LESS THAN (202406),
    PARTITION p202406 VALUES LESS THAN (202407),
    PARTITION p202407 VALUES LESS THAN (202408),
    PARTITION p202408 VALUES LESS THAN (202409),
    PARTITION p202409 VALUES LESS THAN (202410),
    PARTITION p202410 VALUES LESS THAN (202411),
    PARTITION p202411 VALUES LESS THAN (202412),
    PARTITION p202412 VALUES LESS THAN (202501),
    PARTITION p202501 VALUES LESS THAN (202502),
    PARTITION p202502 VALUES LESS THAN (202503),
    PARTITION p202503 VALUES LESS THAN (202504),
    PARTITION p202504 VALUES LESS THAN (202505),
    PARTITION p202505 VALUES LESS THAN (202506),
    PARTITION p202506 VALUES LESS THAN (202507),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- ===========================================
-- Alerts Table
-- ===========================================
CREATE TABLE IF NOT EXISTS alerts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    severity ENUM('info', 'warning', 'critical') NOT NULL,
    type VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    node_id VARCHAR(255),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(255),
    acknowledged_at DATETIME,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at DATETIME,
    details JSON,
    INDEX idx_severity (severity),
    INDEX idx_type (type),
    INDEX idx_timestamp (timestamp),
    INDEX idx_acknowledged (acknowledged)
) ENGINE=InnoDB;

-- ===========================================
-- Configuration Table
-- ===========================================
CREATE TABLE IF NOT EXISTS configurations (
    config_key VARCHAR(255) PRIMARY KEY,
    config_value JSON NOT NULL,
    description TEXT,
    category VARCHAR(100),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(255),
    INDEX idx_category (category)
) ENGINE=InnoDB;

-- ===========================================
-- Scheduled Tasks Table
-- ===========================================
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    cron_expression VARCHAR(100),
    parameters JSON,
    enabled BOOLEAN DEFAULT TRUE,
    last_run DATETIME,
    next_run DATETIME,
    last_status ENUM('success', 'failure', 'running') DEFAULT NULL,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_enabled (enabled),
    INDEX idx_next_run (next_run)
) ENGINE=InnoDB;

-- ===========================================
-- IP Whitelist/Blacklist Table
-- ===========================================
CREATE TABLE IF NOT EXISTS ip_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    cidr_prefix INT DEFAULT 32,
    rule_type ENUM('whitelist', 'blacklist') NOT NULL,
    reason TEXT,
    expires_at DATETIME,
    created_by VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ip (ip_address),
    INDEX idx_rule_type (rule_type),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB;

-- ===========================================
-- Webhooks Table
-- ===========================================
CREATE TABLE IF NOT EXISTS webhooks (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    events JSON NOT NULL,
    secret VARCHAR(255),
    enabled BOOLEAN DEFAULT TRUE,
    retry_count INT DEFAULT 3,
    timeout_ms INT DEFAULT 5000,
    last_triggered DATETIME,
    last_status INT,
    failure_count INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_enabled (enabled)
) ENGINE=InnoDB;

-- ===========================================
-- Geo Routing Rules Table
-- ===========================================
CREATE TABLE IF NOT EXISTS geo_routing_rules (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    priority INT DEFAULT 0,
    source_regions JSON,
    target_regions JSON,
    action ENUM('prefer', 'force', 'exclude', 'block') NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_enabled_priority (enabled, priority)
) ENGINE=InnoDB;

-- ===========================================
-- Default Configuration
-- ===========================================
INSERT INTO configurations (config_key, config_value, description, category) VALUES
    ('system.proxy.default_port', '3128', 'Default proxy port', 'proxy'),
    ('system.proxy.max_connections', '1000', 'Maximum connections per node', 'proxy'),
    ('system.proxy.connection_timeout', '60', 'Connection timeout in seconds', 'proxy'),
    ('system.auth.session_ttl', '3600', 'Session TTL in seconds', 'auth'),
    ('system.auth.max_failed_attempts', '5', 'Max failed login attempts', 'auth'),
    ('system.monitoring.heartbeat_interval', '30', 'Heartbeat interval in seconds', 'monitoring'),
    ('system.monitoring.health_check_threshold', '3', 'Failed health checks before marking unhealthy', 'monitoring'),
    ('system.backup.retention_days', '30', 'Backup retention in days', 'backup'),
    ('system.backup.auto_backup', 'true', 'Enable automatic backups', 'backup'),
    ('system.rate_limit.default_rpm', '100', 'Default rate limit (requests per minute)', 'rate_limit'),
    ('system.rate_limit.burst_size', '20', 'Rate limit burst size', 'rate_limit')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- ===========================================
-- Default Admin User (password: admin123)
-- ===========================================
INSERT INTO users (id, username, password_hash, email, role, status, quota_requests, quota_bandwidth)
VALUES (
    'usr-admin-001',
    'admin',
    '$2b$10$defaulthashplaceholder',
    'admin@proxy-system.local',
    'admin',
    'active',
    999999,
    107374182400
) ON DUPLICATE KEY UPDATE id = id;
