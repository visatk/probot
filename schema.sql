-- Core Group Configuration
CREATE TABLE IF NOT EXISTS group_settings (
    chat_id INTEGER PRIMARY KEY,
    anti_link BOOLEAN DEFAULT 1,
    anti_forward BOOLEAN DEFAULT 0,
    anti_spam BOOLEAN DEFAULT 1,
    anti_flood BOOLEAN DEFAULT 1,
    max_warnings INTEGER DEFAULT 3,
    log_channel_id INTEGER
);

-- Infraction Tracking
CREATE TABLE IF NOT EXISTS user_infractions (
    user_id INTEGER,
    chat_id INTEGER,
    warnings INTEGER DEFAULT 0,
    last_violation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, chat_id)
);

-- Trusted Users (Whitelist)
CREATE TABLE IF NOT EXISTS trusted_users (
    user_id INTEGER,
    chat_id INTEGER,
    added_by INTEGER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, chat_id)
);

-- Telemetry & Auditing
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id TEXT PRIMARY KEY,
    chat_id INTEGER,
    user_id INTEGER,
    action TEXT,
    metadata TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices for optimal query performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_chat ON audit_logs(chat_id);
CREATE INDEX IF NOT EXISTS idx_infractions_user ON user_infractions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_trusted_users_chat ON trusted_users(chat_id);
