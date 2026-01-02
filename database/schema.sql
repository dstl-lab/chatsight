CREATE TABLE IF NOT EXISTS code_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_index INTEGER NOT NULL UNIQUE,
    code_content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

CREATE INDEX IF NOT EXISTS idx_message_index ON code_versions(message_index);

INSERT OR IGNORE INTO code_versions (message_index, code_content) VALUES
(0, 'print("Hello, World!")'),
(1, 'def add(a, b):\n    return a + b'),
(2, 'def multiply(a, b):\n    return a * b');