ALTER TABLE sync_roots
ADD COLUMN exclude_git_tracked INTEGER NOT NULL DEFAULT 0
CHECK (exclude_git_tracked IN (0, 1));
