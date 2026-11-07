// Matches docs/05_API_CONTRACTS.md

export type RuleType = 'INCLUDE' | 'EXCLUDE';

export type SyncAction =
  | 'UploadNew'
  | 'UploadUpdate'
  | 'DownloadNew'
  | 'DownloadUpdate'
  | 'MoveRemoteToTrash'
  | 'MoveLocalToTrash'
  | 'CreateConflictCopy'
  | 'AiMerge'
  | 'MarkClean'
  | 'Skip'
  | 'Blocked';

export type ConflictType =
  | 'ConcurrentModification'
  | 'InitialSyncDifferent'
  | 'LocalDeleteRemoteModified'
  | 'RemoteDeleteLocalModified'
  | 'CaseCollision';

export type ConflictResolution = 'KeepLocal' | 'KeepRemote' | 'KeepBoth';

export type TaskStatus =
  | 'Pending'
  | 'Running'
  | 'RetryWait'
  | 'Succeeded'
  | 'Failed'
  | 'Blocked'
  | 'Cancelled';

export type SyncRootStatus = 'IDLE' | 'SYNCING' | 'PAUSED' | 'CONFLICT' | 'ERROR' | 'DISABLED';

export interface SyncRootDto {
  id: string; // local_root_id
  remoteProjectId: string;
  name: string;
  accountId: string;
  localPath: string;
  remotePath: string;
  enabled: boolean;
  excludeGitTracked: boolean;
  status: SyncRootStatus;
  pollIntervalSeconds: number;
  debounceMs: number;
  lastSyncAt?: number;
  fileCount?: number;
  pendingChanges?: number;
}

export interface SyncRuleDto {
  id?: number;
  ruleType: RuleType;
  pattern: string;
  enabled: boolean;
  priority: number;
}

export interface SyncSummaryDto {
  rootId: string;
  uploaded: number;
  downloaded: number;
  skipped: number;
  conflicts: number;
  blocked: number;
  failed: number;
  startedAt: number;
  finishedAt?: number;
}

export interface WebDavCapabilities {
  serverHeader: string;
  etagType: 'Strong' | 'Weak' | 'None';
  supportsIfMatch: boolean;
  supportsIfNoneMatch: boolean;
  supportsLock: boolean;
  propfindDepth1Supported: boolean;
  safeCreateOnly?: boolean;
  safeUpdateExisting?: boolean;
  safeDelete?: boolean;
  safeMoveNoOverwrite?: boolean;
  probeCleanupWarning?: string;
  maxUploadSpeedMbs?: number;
  testedAt: number;
}

export interface WebDavAccountDto {
  id: string;
  name: string;
  url: string;
  username: string;
  credentialRef: string;
  tlsVerify: boolean;
  capabilities?: WebDavCapabilities;
  lastConnectedAt?: number;
  status: 'ONLINE' | 'OFFLINE' | 'UNTESTED' | 'AUTH_FAILED';
}

export interface ConflictItemDto {
  id: string;
  rootId: string;
  relativePath: string;
  conflictType: ConflictType;
  status: 'UNRESOLVED' | 'RESOLVED';
  detectedAt: number;
  baseVersion?: {
    blake3Hash: string;
    sizeBytes: number;
    modifiedAt: number;
  };
  localVersion: {
    blake3Hash: string;
    sizeBytes: number;
    modifiedAt: number;
    deviceId: string;
    authorDevice: string;
  };
  remoteVersion: {
    etag: string;
    sizeBytes: number;
    modifiedAt: number;
  };
}

export interface TaskDto {
  id: string;
  rootId: string;
  path: string;
  action: SyncAction;
  status: TaskStatus;
  bytesTransferred: number;
  totalBytes: number;
  error?: string;
  errorCode?: string;
  retries: number;
  createdAt: number;
  updatedAt: number;
}

export interface SyncFileItemDto {
  relativePath: string;
  status: 'IN_SYNC' | 'MODIFIED_LOCAL' | 'MODIFIED_REMOTE' | 'CONFLICT' | 'IGNORED';
  sizeBytes: number;
  localModifiedAt: number;
  remoteModifiedAt?: number;
  blake3Hash: string;
}

export interface InitialSyncPreviewDto {
  rootId: string;
  uploadsCount: number;
  downloadsCount: number;
  identicalCount: number;
  conflictsCount: number;
  blockedCount: number;
  totalUploadBytes: number;
  totalDownloadBytes: number;
  items: Array<{
    relativePath: string;
    action: SyncAction;
    sizeBytes: number;
    reason: string;
  }>;
}

export interface HistoryItemDto {
  id: string;
  rootId: string;
  projectName: string;
  relativePath: string;
  action: SyncAction;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  bytes: number;
  timestamp: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface CreateWebDavAccountInput {
  name: string;
  url: string;
  username: string;
  password: string;
  tlsVerify: boolean;
}

export interface AppSettingsDto {
  deviceId: string;
  deviceName: string;
  pollIntervalSeconds: number;
  debounceMs: number;
  autoStart: boolean;
  startMinimized: boolean;
  retryLimit: number;
}

export interface RemoteEntryDto {
  path: string;
  name: string;
  isCollection: boolean;
  size: number;
  modifiedAt: number;
  etag?: string;
}

export interface RuleImpactDto {
  newlyIncluded: string[];
  newlyExcluded: string[];
  unchanged: number;
}

export interface DiscoveredProject { accountId: string; remotePath: string; remoteProjectId: string | null; name: string; }

export interface AiSettingsDto {
  endpoint: string;
  model: string;
  hasApiKey: boolean;
  configured: boolean;
  mergePrompt: string;
}

export interface SaveAiSettingsInput {
  endpoint: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
  mergePrompt: string;
}

export interface AiConnectionTestDto {
  message: string;
  model: string;
  latencyMs: number;
}

export interface AiMergePreviewDto {
  previewId: string;
  conflictId: string;
  relativePath: string;
  mergedContent: string;
  localContent?: string;
  remoteContent?: string;
  suggestions?: string;
  localSize: number;
  remoteSize: number;
  model: string;
  createdAt: number;
  expiresAt: number;
}

export interface RefineAiMergeInput {
  conflictId: string;
  previewId: string;
  instruction: string;
  currentContent?: string;
}
