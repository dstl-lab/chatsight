CREATE TABLE IF NOT EXISTS code_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_index INTEGER NOT NULL UNIQUE,
    code_content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_index ON code_versions(message_index);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_filename_created_at ON files(filename, created_at);

CREATE TABLE IF NOT EXISTS assignment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    assignment_ref TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
    student TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    role TEXT,
    timestamp TEXT,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assignment_file_ref ON assignment(file_id, assignment_ref);
CREATE INDEX IF NOT EXISTS idx_assignment_file_id ON assignment(file_id);
CREATE INDEX IF NOT EXISTS idx_conversation_assignment_id ON conversation(assignment_id);
CREATE INDEX IF NOT EXISTS idx_message_conversation_id ON message(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_sort ON message(conversation_id, sort_order);

INSERT OR IGNORE INTO code_versions (message_index, code_content) VALUES
(0, 'print("Hello, World!")'),
(1, 'def add(a, b):\n    return a + b'),
(2, 'def multiply(a, b):\n    return a * b');