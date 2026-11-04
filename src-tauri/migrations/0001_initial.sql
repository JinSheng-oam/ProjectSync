PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webdav_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    username TEXT NOT NULL,
    credential_ref TEXT NOT NULL,
    tls_verify INTEGER NOT NULL DEFAULT 1 CHECK (tls_verify IN (0,1)),
    capability_json TEXT,
    connection_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    last_connected_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_roots (
    id TEXT PRIMARY KEY,                       -- local_root_id
    remote_project_id TEXT NOT NULL,           -- shared across devices
    account_id TEXT NOT NULL,
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
    FOREIGN KEY (account_id) REFERENCES webdav_accounts(id) ON DELETE RESTRICT,
    UNIQUE (account_id, remote_path)
);

CREATE INDEX IF NOT EXISTS idx_sync_roots_account ON sync_roots(account_id);
CREATE INDEX IF NOT EXISTS idx_sync_roots_enabled ON sync_roots(enabled, deleted_at);

CREATE TABLE IF NOT EXISTS sync_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('INCLUDE','EXCLUDE')),
    pattern TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (root_id) REFERENCES sync_roots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_rules_root ON sync_rules(root_id, enabled, priority);

CREATE TABLE IF NOT EXISTS sync_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    path_key TEXT NOT NULL,
    baseline_state TEXT NOT NULL DEFAULT 'UNKNOWN'
        CHECK (baseline_state IN ('UNKNOWN','PRESENT','DELETED')),
    base_hash TEXT,
    local_exists INTEGER NOT NULL DEFAULT 0 CHECK (local_exists IN (0,1)),
    local_hash TEXT,
    local_size INTEGER,
    local_mtime_ns INTEGER,
    remote_exists INTEGER NOT NULL DEFAULT 0 CHECK (remote_exists IN (0,1)),
    remote_hash TEXT,
    remote_etag TEXT,
    remote_size INTEGER,
    remote_mtime_ms INTEGER,
    sync_state TEXT NOT NULL DEFAULT 'UNKNOWN',
    last_synced_at INTEGER,
    last_observed_at INTEGER,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (root_id) REFERENCES sync_roots(id) ON DELETE CASCADE,
    UNIQUE (root_id, path_key),
    CHECK (
      (baseline_state = 'PRESENT' AND base_hash IS NOT NULL)
      OR
      (baseline_state IN ('UNKNOWN','DELETED') AND base_hash IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_sync_files_root ON sync_files(root_id);
CREATE INDEX IF NOT EXISTS idx_sync_files_state ON sync_files(root_id, sync_state);
CREATE INDEX IF NOT EXISTS idx_sync_files_path ON sync_files(root_id, relative_path);

CREATE TABLE IF NOT EXISTS sync_tasks (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','BLOCKED','CANCELLED')),
    priority INTEGER NOT NULL DEFAULT 100,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER,
    bytes_total INTEGER NOT NULL DEFAULT 0,
    bytes_transferred INTEGER NOT NULL DEFAULT 0,
    expected_local_hash TEXT,
    expected_remote_etag TEXT,
    idempotency_key TEXT NOT NULL,
    staging_path TEXT,
    payload_json TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (root_id) REFERENCES sync_roots(id) ON DELETE CASCADE,
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_tasks_pending ON sync_tasks(status, next_retry_at, priority);
CREATE INDEX IF NOT EXISTS idx_sync_tasks_root ON sync_tasks(root_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_tasks_path ON sync_tasks(root_id, relative_path, status);

CREATE TABLE IF NOT EXISTS sync_conflicts (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    conflict_type TEXT NOT NULL,
    local_hash TEXT,
    remote_hash TEXT,
    base_hash TEXT,
    local_snapshot_path TEXT,
    remote_etag TEXT,
    conflict_copy_path TEXT,
    status TEXT NOT NULL DEFAULT 'UNRESOLVED',
    resolution TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (root_id) REFERENCES sync_roots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(root_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_path ON sync_conflicts(root_id, relative_path);

CREATE TABLE IF NOT EXISTS sync_tombstones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('LOCAL','REMOTE')),
    previous_hash TEXT,
    observed_counterpart_hash TEXT,
    device_id TEXT NOT NULL,
    trash_path TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (root_id) REFERENCES sync_roots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_root ON sync_tombstones(root_id, status);

CREATE TABLE IF NOT EXISTS sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id TEXT NOT NULL,
    task_id TEXT,
    relative_path TEXT,
    operation TEXT NOT NULL,
    direction TEXT,
    result TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (root_id) REFERENCES sync_roots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_history_root_time ON sync_history(root_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_history_result ON sync_history(result);

CREATE TABLE IF NOT EXISTS server_capability_probes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    server_fingerprint TEXT,
    server_version TEXT,
    image_digest TEXT,
    probed_at INTEGER NOT NULL,
    basic_auth_ok INTEGER NOT NULL DEFAULT 0,
    propfind_ok INTEGER NOT NULL DEFAULT 0,
    mkcol_ok INTEGER NOT NULL DEFAULT 0,
    put_get_ok INTEGER NOT NULL DEFAULT 0,
    etag_observed INTEGER NOT NULL DEFAULT 0,
    if_match_put_safe INTEGER NOT NULL DEFAULT 0,
    if_none_match_safe INTEGER NOT NULL DEFAULT 0,
    lock_exclusion_safe INTEGER NOT NULL DEFAULT 0,
    move_no_overwrite_safe INTEGER NOT NULL DEFAULT 0,
    safe_update_existing INTEGER NOT NULL DEFAULT 0,
    safe_create_only INTEGER NOT NULL DEFAULT 0,
    safe_delete INTEGER NOT NULL DEFAULT 0,
    report_json TEXT,
    FOREIGN KEY (account_id) REFERENCES webdav_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_capability_probe_account_time
ON server_capability_probes(account_id, probed_at DESC);
