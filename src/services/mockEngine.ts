import type {
  SyncRootDto,
  SyncRuleDto,
  WebDavAccountDto,
  ConflictItemDto,
  ConflictResolution,
  TaskDto,
  HistoryItemDto,
  SyncFileItemDto,
  InitialSyncPreviewDto,
  WebDavCapabilities,
  CreateWebDavAccountInput,
} from '../types/dto';
import {
  INITIAL_ACCOUNTS,
  INITIAL_ROOTS,
  INITIAL_RULES,
  INITIAL_CONFLICTS,
  INITIAL_TASKS,
  INITIAL_FILES,
  INITIAL_HISTORY,
} from './mockData';

// In-memory state for mock mode
class MockEngine {
  accounts: WebDavAccountDto[] = [...INITIAL_ACCOUNTS];
  roots: SyncRootDto[] = [...INITIAL_ROOTS];
  rules: Record<string, SyncRuleDto[]> = { ...INITIAL_RULES };
  conflicts: ConflictItemDto[] = [...INITIAL_CONFLICTS];
  tasks: TaskDto[] = [...INITIAL_TASKS];
  files: Record<string, SyncFileItemDto[]> = { ...INITIAL_FILES };
  history: HistoryItemDto[] = [...INITIAL_HISTORY];

  // Simulates network latency
  private async delay(ms = 250): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async listSyncRoots(): Promise<SyncRootDto[]> {
    await this.delay(150);
    return [...this.roots];
  }

  async syncNow(rootId: string): Promise<void> {
    await this.delay(300);
    const root = this.roots.find((r) => r.id === rootId);
    if (root) {
      root.status = 'SYNCING';
      root.pendingChanges = 0;
      // Add a simulated task
      const newTask: TaskDto = {
        id: `task_${Date.now()}`,
        rootId,
        path: 'docs/architecture_notes.md',
        action: 'UploadUpdate',
        status: 'Running',
        bytesTransferred: 1200,
        totalBytes: 4500,
        retries: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.tasks.unshift(newTask);
      setTimeout(() => {
        newTask.status = 'Succeeded';
        newTask.bytesTransferred = newTask.totalBytes;
        if (root.status === 'SYNCING') root.status = 'IDLE';
        root.lastSyncAt = Date.now();
      }, 2500);
    }
  }

  async pauseSync(rootId: string): Promise<void> {
    await this.delay(100);
    const root = this.roots.find((r) => r.id === rootId);
    if (root) root.status = 'PAUSED';
  }

  async resumeSync(rootId: string): Promise<void> {
    await this.delay(100);
    const root = this.roots.find((r) => r.id === rootId);
    if (root) root.status = 'IDLE';
  }

  async listConflicts(): Promise<ConflictItemDto[]> {
    await this.delay(150);
    return [...this.conflicts];
  }

  async resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<{ success: boolean; message: string }> {
    await this.delay(400);
    const index = this.conflicts.findIndex((c) => c.id === conflictId);
    if (index === -1) {
      throw new Error('Conflict item not found or already resolved.');
    }
    const item = this.conflicts[index];
    this.conflicts.splice(index, 1);

    // Record in history
    let message = '';
    if (resolution === 'KeepBoth') {
      message = `已应用 KEEP_BOTH 策略：保留本地及远程双版本，生成冲突副本文件 ${item.relativePath}.conflict-${new Date().toISOString().slice(0, 10)}.md`;
      this.history.unshift({
        id: `hist_${Date.now()}`,
        rootId: item.rootId,
        projectName: this.roots.find((r) => r.id === item.rootId)?.name || 'Project',
        relativePath: item.relativePath,
        action: 'CreateConflictCopy',
        status: 'SUCCESS',
        bytes: item.localVersion.sizeBytes,
        timestamp: Date.now(),
      });
    } else if (resolution === 'KeepLocal') {
      message = `已应用 KEEP_LOCAL 策略：本地版本已上传覆盖远程，并通过服务端条件写入或独占锁保护。`;
      this.history.unshift({
        id: `hist_${Date.now()}`,
        rootId: item.rootId,
        projectName: this.roots.find((r) => r.id === item.rootId)?.name || 'Project',
        relativePath: item.relativePath,
        action: 'UploadUpdate',
        status: 'SUCCESS',
        bytes: item.localVersion.sizeBytes,
        timestamp: Date.now(),
      });
    } else {
      message = `已应用 KEEP_REMOTE 策略：远程版本已下载生效，本地原文件已安全移至本地回收站 (.projectsync/trash)。`;
      this.history.unshift({
        id: `hist_${Date.now()}`,
        rootId: item.rootId,
        projectName: this.roots.find((r) => r.id === item.rootId)?.name || 'Project',
        relativePath: item.relativePath,
        action: 'DownloadUpdate',
        status: 'SUCCESS',
        bytes: item.remoteVersion.sizeBytes,
        timestamp: Date.now(),
      });
    }

    // Check if root still has conflicts
    const remainingForRoot = this.conflicts.filter((c) => c.rootId === item.rootId);
    const root = this.roots.find((r) => r.id === item.rootId);
    if (root && remainingForRoot.length === 0) {
      root.status = 'IDLE';
    }

    return { success: true, message };
  }

  async excludeConflictFile(conflictId: string): Promise<{ success: boolean; message: string }> {
    await this.delay(200);
    const index = this.conflicts.findIndex((conflict) => conflict.id === conflictId);
    if (index < 0) throw new Error('Conflict item not found or already resolved.');
    const conflict = this.conflicts[index];
    const rules = this.rules[conflict.rootId] || [];
    if (!rules.some((rule) => rule.enabled && rule.ruleType === 'EXCLUDE' && rule.pattern === conflict.relativePath)) {
      this.rules[conflict.rootId] = [...rules, {
        ruleType: 'EXCLUDE',
        pattern: conflict.relativePath,
        enabled: true,
        priority: Math.max(0, ...rules.map((rule) => rule.priority)) + 1,
      }];
    }
    this.conflicts.splice(index, 1);
    return { success: true, message: `已将 ${conflict.relativePath} 加入排除规则；本地和远端现有文件均保留，后续同步将跳过此文件。` };
  }

  async listWebDavAccounts(): Promise<WebDavAccountDto[]> {
    await this.delay(100);
    return [...this.accounts];
  }

  async testWebDavConnection(url: string, _username: string, _password = '', _tlsVerify = true): Promise<WebDavCapabilities> {
    await this.delay(800);
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('WebDAV URL 必须以 http:// 或 https:// 开头');
    }
    return {
      serverHeader: 'hacdias/webdav (兼容探测通过)',
      etagType: 'Strong',
      supportsIfMatch: true,
      supportsIfNoneMatch: true,
      supportsLock: true,
      propfindDepth1Supported: true,
      maxUploadSpeedMbs: 35.8,
      testedAt: Date.now(),
    };
  }

  async createWebDavAccount(account: CreateWebDavAccountInput): Promise<WebDavAccountDto> {
    await this.delay(300);
    const { password: _password, ...safeAccount } = account;
    const newAcc: WebDavAccountDto = {
      ...safeAccount,
      id: `acc_${Date.now()}`,
      credentialRef: `wincred://projectsync/acc_${Date.now()}`,
      status: 'ONLINE',
      lastConnectedAt: Date.now(),
    };
    this.accounts.push(newAcc);
    return newAcc;
  }

  async previewInitialSync(_accountId: string, _localPath: string, _remotePath: string, _rules: SyncRuleDto[], _excludeGitTracked: boolean): Promise<InitialSyncPreviewDto> {
    await this.delay(600);
    return {
      rootId: 'preview_root',
      uploadsCount: 3,
      downloadsCount: 1,
      identicalCount: 0,
      conflictsCount: 1,
      blockedCount: 0,
      totalUploadBytes: 6892 + 6166 + 990,
      totalDownloadBytes: 7941,
      items: [
        { relativePath: 'docs/01_PRD.md', action: 'UploadNew', sizeBytes: 6892, reason: '本地新增文件' },
        { relativePath: 'docs/02_ARCHITECTURE.md', action: 'UploadNew', sizeBytes: 6166, reason: '本地新增文件' },
        { relativePath: 'docs/03_SYNC_ALGORITHM.md', action: 'CreateConflictCopy', sizeBytes: 7228, reason: '远端已存在同名但不同Hash文件，命中初次同步冲突' },
        { relativePath: 'config/project.example.toml', action: 'UploadNew', sizeBytes: 990, reason: '本地新增文件' },
        { relativePath: 'sql/0001_initial.sql', action: 'DownloadNew', sizeBytes: 7941, reason: '仅远端存在' },
      ],
    };
  }

  async createSyncRoot(data: {
    name: string;
    accountId: string;
    localPath: string;
    remotePath: string;
    rules: SyncRuleDto[];
    excludeGitTracked: boolean;
  }): Promise<SyncRootDto> {
    await this.delay(400);
    const newRoot: SyncRootDto = {
      id: `root_${Date.now()}`,
      remoteProjectId: `proj_remote_${Math.random().toString(36).slice(2, 8)}`,
      name: data.name,
      accountId: data.accountId,
      localPath: data.localPath,
      remotePath: data.remotePath,
      enabled: true,
      excludeGitTracked: data.excludeGitTracked,
      status: 'IDLE',
      pollIntervalSeconds: 30,
      debounceMs: 500,
      lastSyncAt: Date.now(),
      fileCount: 18,
      pendingChanges: 0,
    };
    this.roots.unshift(newRoot);
    this.rules[newRoot.id] = data.rules;
    return newRoot;
  }

  async getSyncRules(rootId: string): Promise<SyncRuleDto[]> {
    await this.delay(100);
    return [...(this.rules[rootId] || [])];
  }

  async updateSyncRoot(rootId: string, data: { name: string; pollIntervalSeconds: number; debounceMs: number; excludeGitTracked: boolean }): Promise<void> {
    await this.delay(100);
    const root = this.roots.find((item) => item.id === rootId);
    if (!root) throw new Error('同步项目不存在');
    Object.assign(root, data);
  }

  async replaceSyncRules(rootId: string, newRules: SyncRuleDto[]): Promise<void> {
    await this.delay(200);
    this.rules[rootId] = [...newRules];
  }

  async getFiles(rootId: string): Promise<SyncFileItemDto[]> {
    await this.delay(150);
    return [...(this.files[rootId] || [])];
  }

  async getPendingTasks(): Promise<TaskDto[]> {
    await this.delay(100);
    return [...this.tasks];
  }

  async querySyncHistory(keyword = '', limit = 50): Promise<HistoryItemDto[]> {
    await this.delay(150);
    let result = [...this.history];
    if (keyword) {
      result = result.filter((h) => h.relativePath.toLowerCase().includes(keyword.toLowerCase()) || h.projectName.toLowerCase().includes(keyword.toLowerCase()));
    }
    return result.slice(0, limit);
  }
}

export const mockEngine = new MockEngine();
