-- The migration runner disables foreign keys on its dedicated connection while
-- rebuilding this table. Dependent rows stay in place and are checked below.
CREATE TABLE sync_roots_new (
    id TEXT PRIMARY KEY,
    remote_project_id TEXT NOT NULL,
    account_id TEXT,
    name TEXT NOT NULL,
    local_path TEXT NOT NULL,
    remote_path TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    sync_mode TEXT NOT NULL DEFAULT 'BIDIRECTIONAL',
    conflict_policy TEXT NOT NULL DEFAULT 'KEEP_BOTH',
    delete_policy TEXT NOT NULL DEFAULT 'TRASH',
    poll_interval_seconds INTEGER NOT NULL DEFAULT 60,
    debounce_ms INTEGER NOT NULL DEFAULT 1200,
    max_parallel_transfers INTEGER NOT NULL DEFAULT 2,
    initial_sync_completed INTEGER NOT NULL DEFAULT 0 CHECK (initial_sync_completed IN (0,1)),
    initial_sync_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (initial_sync_confirmed IN (0,1)),
    last_full_scan_at INTEGER,
    last_sync_at INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'IDLE',
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    exclude_git_tracked INTEGER NOT NULL DEFAULT 0 CHECK (exclude_git_tracked IN (0,1)),
    CHECK (account_id IS NOT NULL OR deleted_at IS NOT NULL),
    FOREIGN KEY (account_id) REFERENCES webdav_accounts(id) ON DELETE SET NULL
);

INSERT INTO sync_roots_new SELECT * FROM sync_roots;
DROP TABLE sync_roots;
ALTER TABLE sync_roots_new RENAME TO sync_roots;

CREATE INDEX idx_sync_roots_account ON sync_roots(account_id);
CREATE INDEX idx_sync_roots_enabled ON sync_roots(enabled, deleted_at);
CREATE UNIQUE INDEX idx_sync_roots_active_account_path
ON sync_roots(account_id, remote_path) WHERE deleted_at IS NULL;

-- Fail and roll back the entire migration if rebuilding broke any references.
CREATE TEMP TABLE migration_5_fk_check (violations INTEGER NOT NULL CHECK (violations = 0));
INSERT INTO migration_5_fk_check SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE migration_5_fk_check;
