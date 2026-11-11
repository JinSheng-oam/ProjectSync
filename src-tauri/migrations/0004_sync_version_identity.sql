ALTER TABLE sync_files ADD COLUMN base_remote_hash TEXT;
UPDATE sync_files SET base_remote_hash = remote_hash
WHERE baseline_state = 'PRESENT' AND sync_state = 'LINE_ENDINGS_EQUIVALENT';

-- Older clients could store an ETag from a different response than the hash.
UPDATE sync_files SET remote_etag = NULL;

ALTER TABLE sync_tasks ADD COLUMN expected_remote_hash TEXT;
