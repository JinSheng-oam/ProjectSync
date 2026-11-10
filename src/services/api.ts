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
  AppSettingsDto,
  RemoteEntryDto,
  RuleImpactDto,
  AiSettingsDto,
  SaveAiSettingsInput,
  AiConnectionTestDto,
  AiMergePreviewDto,
  RefineAiMergeInput,
} from '../types/dto';
import { mockEngine } from './mockEngine';

export { mockEngine } from './mockEngine';

// Check if running in real Tauri window
const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let mockAiSettings: AiSettingsDto = {
  useCodexForMerge: false,
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  hasApiKey: false,
  configured: true,
  mergePrompt: '合并本地与远端修改，保留双方意图；不要引入新事实、删除无关内容或改变文件格式。',
};

export const api = {
  isTauri: isTauriEnv,

  async listSyncRoots(): Promise<SyncRootDto[]> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('list_sync_roots');
    }
    return mockEngine.listSyncRoots();
  },

  async confirmInitialSync(rootId: string): Promise<void> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('confirm_initial_sync', { rootId });
      return;
    }
    return;
  },

  async syncNow(rootId: string): Promise<void> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('sync_now', { rootId });
    }
    return mockEngine.syncNow(rootId);
  },

  async pauseSync(rootId: string): Promise<void> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('pause_sync', { rootId });
    }
    return mockEngine.pauseSync(rootId);
  },

  async resumeSync(rootId: string): Promise<void> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('resume_sync', { rootId });
    }
    return mockEngine.resumeSync(rootId);
  },

  async listConflicts(): Promise<ConflictItemDto[]> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('list_conflicts');
    }
    return mockEngine.listConflicts();
  },

  async resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<{ success: boolean; message: string }> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('resolve_conflict', { conflictId, resolution });
    }
    return mockEngine.resolveConflict(conflictId, resolution);
  },

  async excludeConflictFile(conflictId: string): Promise<{ success: boolean; message: string }> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('exclude_conflict_file', { conflictId });
    }
    return mockEngine.excludeConflictFile(conflictId);
  },

  async listWebDavAccounts(): Promise<WebDavAccountDto[]> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('list_webdav_accounts');
    }
    return mockEngine.listWebDavAccounts();
  },

  async testWebDavConnection(url: string, username: string, password: string, tlsVerify = true): Promise<WebDavCapabilities> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('test_webdav_connection', { url, username, password, tlsVerify });
    }
    return mockEngine.testWebDavConnection(url, username, password, tlsVerify);
  },

  async createWebDavAccount(account: CreateWebDavAccountInput): Promise<WebDavAccountDto> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('create_webdav_account', { account });
    }
    return mockEngine.createWebDavAccount(account);
  },

  async previewInitialSync(accountId: string, localPath: string, remotePath: string, rules: SyncRuleDto[], excludeGitTracked: boolean): Promise<InitialSyncPreviewDto> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('preview_initial_sync', { accountId, localPath, remotePath, rules, excludeGitTracked });
    }
    return mockEngine.previewInitialSync(accountId, localPath, remotePath, rules, excludeGitTracked);
  },

  async createSyncRoot(data: {
    name: string;
    accountId: string;
    localPath: string;
    remotePath: string;
    rules: SyncRuleDto[];
    excludeGitTracked: boolean;
  }): Promise<SyncRootDto> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('create_sync_root', { data });
    }
    return mockEngine.createSyncRoot(data);
  },

  async getSyncRules(rootId: string): Promise<SyncRuleDto[]> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('get_sync_rules', { rootId });
    }
    return mockEngine.getSyncRules(rootId);
  },

  async replaceSyncRules(rootId: string, newRules: SyncRuleDto[]): Promise<void> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('replace_sync_rules', { rootId, rules: newRules });
    }
    return mockEngine.replaceSyncRules(rootId, newRules);
  },

  async getFiles(rootId: string): Promise<SyncFileItemDto[]> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('list_files', { rootId });
    }
    return mockEngine.getFiles(rootId);
  },

  async getPendingTasks(): Promise<TaskDto[]> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('get_pending_tasks');
    }
    return mockEngine.getPendingTasks();
  },

  async querySyncHistory(keyword = '', limit = 50): Promise<HistoryItemDto[]> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('query_sync_history', { keyword, rootId: null, limit, offset: 0 });
    }
    return mockEngine.querySyncHistory(keyword, limit);
  },

  async updateWebDavAccount(accountId: string, account: { name: string; url: string; username: string; password?: string; tlsVerify: boolean }): Promise<WebDavAccountDto> {
    if (!isTauriEnv) throw new Error('WebDAV account editing is available in the desktop app.');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('update_webdav_account', { accountId, account });
  },

  async deleteWebDavAccount(accountId: string): Promise<void> {
    if (!isTauriEnv) throw new Error('WebDAV account management is available in the desktop app.');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('delete_webdav_account', { accountId });
  },

  async browseRemoteDirectory(accountId: string, path: string): Promise<RemoteEntryDto[]> {
    if (!isTauriEnv) return [];
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('browse_remote_directory', { accountId, path });
  },

  async updateSyncRoot(rootId: string, data: { name: string; pollIntervalSeconds: number; debounceMs: number; excludeGitTracked: boolean }): Promise<void> {
    if (isTauriEnv) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('update_sync_root', { rootId, data });
    }
    return mockEngine.updateSyncRoot(rootId, data);
  },

  async deleteSyncRoot(rootId: string): Promise<void> {
    if (!isTauriEnv) return;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('delete_sync_root', { rootId });
  },

  async enableSyncRoot(rootId: string): Promise<void> {
    if (!isTauriEnv) return;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('enable_sync_root', { rootId });
  },

  async disableSyncRoot(rootId: string): Promise<void> {
    if (!isTauriEnv) return;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('disable_sync_root', { rootId });
  },

  async getSyncStatus(rootId: string) {
    if (!isTauriEnv) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_sync_status', { rootId });
  },

  async retryFailedTask(taskId: string) {
    if (!isTauriEnv) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('retry_failed_task', { taskId });
  },

  async cancelSyncTask(taskId: string) {
    if (!isTauriEnv) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('cancel_sync_task', { taskId });
  },

  async previewRuleImpact(rootId: string, rules: SyncRuleDto[]): Promise<RuleImpactDto> {
    if (!isTauriEnv) return { newlyIncluded: [], newlyExcluded: [], unchanged: 0 };
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<RuleImpactDto>('preview_rule_impact', { rootId, rules });
  },

  async explainSyncRule(path: string, rules: SyncRuleDto[]): Promise<string> {
    if (!isTauriEnv) {
      const normalizedPath = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!normalizedPath) return '请输入有效的文件相对路径。';

      if (normalizedPath.split('/').some(p => p.toLowerCase() === '.projectsync')) {
        return 'ProjectSync 内部元数据目录不会同步。';
      }

      const enabledRules = rules.filter((r) => r.enabled);
      const excludeRules = enabledRules.filter((r) => r.ruleType === 'EXCLUDE');
      const includeRules = enabledRules.filter((r) => r.ruleType === 'INCLUDE');

      const matchGlob = (pat: string, targetStr: string) => {
        let p = pat.trim().replace(/\\/g, '/');
        const special = ['.', '+', '^', '$', '(', ')', '{', '}', '|', '[', ']'];
        for (const char of special) {
          p = p.split(char).join('\\' + char);
        }
        p = p.split('**').join('.*');
        p = p.split('*').join('[^/]*');
        p = p.split('?').join('.');
        try {
          const reg = new RegExp('^' + p + '$', 'i');
          return reg.test(targetStr) || reg.test('/' + targetStr) || new RegExp(p, 'i').test(targetStr);
        } catch {
          return false;
        }
      };

      for (const rule of excludeRules) {
        if (matchGlob(rule.pattern, normalizedPath)) {
          return `文件将被【排除】：命中排除规则「${rule.pattern}」（排除规则优先判定）。`;
        }
      }

      if (includeRules.length > 0) {
        const matched = includeRules.find((rule) => matchGlob(rule.pattern, normalizedPath));
        if (matched) {
          return `文件将被【同步】：命中包含规则「${matched.pattern}」。`;
        }
        return `文件将被【忽略】：已开启白名单过滤（${includeRules.length} 条包含规则），该路径未命中任何包含规则。`;
      }

      return '文件将被【同步】：未命中任何排除规则，且未限制包含范围。';
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('explain_sync_rule', { path, rules });
  },

  async pickLocalDirectory(): Promise<string | null> {
    if (!isTauriEnv) return null;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title: '选择本地项目目录' });
    return typeof selected === 'string' ? selected : null;
  },

  async getConflictDetail(conflictId: string): Promise<ConflictItemDto> {
    if (!isTauriEnv) {
      const item = mockEngine.conflicts.find((conflict) => conflict.id === conflictId);
      if (!item) throw new Error('Conflict not found.');
      return item;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_conflict_detail', { conflictId });
  },

  async exportDiagnostics(destination: string): Promise<void> {
    if (!isTauriEnv) throw new Error('Diagnostic export is available in the desktop app.');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('export_diagnostics', { destination });
  },

  async backupDatabase(destination: string): Promise<number> {
    if (!isTauriEnv) throw new Error('Database backup is available in the desktop app.');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<number>('backup_database', { destination });
  },

  async getAppSettings(): Promise<AppSettingsDto | null> {
    if (!isTauriEnv) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_app_settings');
  },

  async updateAppSettings(settings: Record<string, unknown>): Promise<void> {
    if (!isTauriEnv) return;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('update_app_settings', { settings });
  },

  async getAiSettings(): Promise<AiSettingsDto> {
    if (!isTauriEnv) return { ...mockAiSettings };
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AiSettingsDto>('get_ai_settings');
  },

  async saveAiSettings(settings: SaveAiSettingsInput): Promise<AiSettingsDto> {
    if (!isTauriEnv) {
      mockAiSettings = {
        useCodexForMerge: settings.useCodexForMerge,
        endpoint: settings.endpoint.trim(),
        model: settings.model.trim(),
        hasApiKey: settings.clearApiKey ? false : Boolean(settings.apiKey?.trim()) || mockAiSettings.hasApiKey,
        configured: Boolean(settings.endpoint.trim() && settings.model.trim()),
        mergePrompt: settings.mergePrompt.trim(),
      };
      return { ...mockAiSettings };
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AiSettingsDto>('save_ai_settings', { settings });
  },

  async testAiSettings(input?: { endpoint: string; model: string; apiKey?: string; useCodexForMerge?: boolean }): Promise<AiConnectionTestDto> {
    if (!isTauriEnv && input?.useCodexForMerge) throw new Error('请在桌面版测试 Codex CLI。');
    if (!isTauriEnv) return { message: '连接成功，模型返回：OK', model: input?.model || mockAiSettings.model, latencyMs: 320 };
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AiConnectionTestDto>('test_ai_settings', { input });
  },

  async listAiModels(endpoint: string, apiKey?: string): Promise<string[]> {
    if (!isTauriEnv) {
      return ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'];
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string[]>('list_ai_models', {
      input: { endpoint, apiKey: apiKey || undefined },
    });
  },

  async listAiScopePaths(localPath: string): Promise<string[]> {
    if (!isTauriEnv) return ['README.md', 'package.json', 'docs/overview.md', 'src/main.tsx'];
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string[]>('list_ai_scope_paths', { localPath });
  },

  async suggestAiScope(instruction: string, paths: string[]): Promise<SyncRuleDto[]> {
    if (!isTauriEnv) {
      return [
        { id: -1, ruleType: 'INCLUDE', pattern: '**/*.md', enabled: true, priority: 10 },
        { id: -2, ruleType: 'INCLUDE', pattern: '**/docs/**', enabled: true, priority: 20 },
        { id: -3, ruleType: 'EXCLUDE', pattern: '**/node_modules/**', enabled: true, priority: 30 },
      ];
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<SyncRuleDto[]>('suggest_ai_scope', { input: { instruction, paths } });
  },

  async previewAiMerge(conflictId: string): Promise<AiMergePreviewDto> {
    if (!isTauriEnv) {
      return {
        previewId: '00000000-0000-4000-8000-000000000001',
        conflictId,
        relativePath: 'docs/merge-preview.md',
        mergedContent: '# 合并预览\n\n本地与远端内容已合并。',
        localContent: '# 本地版本\n\n这里显示本地冲突文件原文。',
        remoteContent: '# 远端版本\n\n这里显示 WebDAV 上的冲突文件原文。',
        suggestions: '检测到本地新增了部分实现逻辑，远端更新了配置说明。已合并双方有效变更，请审阅下方的代码或在右侧发送指令继续微调。',
        localSize: 1024,
        remoteSize: 1280,
        model: mockAiSettings.model,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7_200_000,
      };
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AiMergePreviewDto>('preview_ai_merge', { conflictId });
  },

  async refineAiMerge(input: RefineAiMergeInput): Promise<AiMergePreviewDto> {
    if (!isTauriEnv) {
      return {
        previewId: input.previewId,
        conflictId: input.conflictId,
        relativePath: 'docs/merge-preview.md',
        mergedContent: (input.currentContent || '# 合并预览\n\n本地与远端内容已合并。') + `\n\n// [AI Agent 修改记录]: 已按指令「${input.instruction}」调整`,
        localContent: '# 本地版本\n\n这里显示本地冲突文件原文。',
        remoteContent: '# 远端版本\n\n这里显示 WebDAV 上的冲突文件原文。',
        suggestions: `已根据您的指令「${input.instruction}」对合并内容进行修改，请继续审阅。如需进一步微调可继续输入。`,
        localSize: 1024,
        remoteSize: 1280,
        model: mockAiSettings.model,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7_200_000,
      };
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AiMergePreviewDto>('refine_ai_merge', { input });
  },

  async applyAiMerge(conflictId: string, previewId: string): Promise<{ success: boolean; message: string }> {
    if (!isTauriEnv) return { success: true, message: 'AI 合并已写入本地与 WebDAV；合并前两版已备份。' };
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('apply_ai_merge', { conflictId, previewId });
  },
};
