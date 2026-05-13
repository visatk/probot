CREATE TABLE IF NOT EXISTS group_settings (
    chat_id INTEGER PRIMARY KEY,
    anti_link BOOLEAN DEFAULT 1,
    max_warnings INTEGER DEFAULT 3
);

CREATE TABLE IF NOT EXISTS user_infractions (
    user_id INTEGER,
    chat_id INTEGER,
    warnings INTEGER DEFAULT 0,
    last_violation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    log_id TEXT PRIMARY KEY,
    chat_id INTEGER,
    user_id INTEGER,
    action TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
