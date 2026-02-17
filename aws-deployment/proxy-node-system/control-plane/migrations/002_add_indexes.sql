-- ===========================================
-- Migration 002: Additional Indexes
-- ===========================================

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_access_logs_node_time 
    ON access_logs (node_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_access_logs_user_time 
    ON access_logs (user_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action_time 
    ON audit_logs (user_id, action, timestamp);

CREATE INDEX IF NOT EXISTS idx_alerts_node_severity 
    ON alerts (node_id, severity, timestamp);

-- Full-text index for searching
ALTER TABLE audit_logs ADD FULLTEXT INDEX ft_details (action) IF NOT EXISTS;
ALTER TABLE alerts ADD FULLTEXT INDEX ft_message (message) IF NOT EXISTS;

-- Index for cleanup jobs
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup 
    ON sessions (expires_at, user_id);

-- Index for IP rules lookup
CREATE INDEX IF NOT EXISTS idx_ip_rules_lookup 
    ON ip_rules (rule_type, ip_address, expires_at);
