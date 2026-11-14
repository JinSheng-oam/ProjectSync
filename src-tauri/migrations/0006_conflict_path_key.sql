ALTER TABLE sync_conflicts ADD COLUMN path_key TEXT;
CREATE INDEX idx_sync_conflicts_root_key_status ON sync_conflicts(root_id, path_key, status);
