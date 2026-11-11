import { useState, useEffect, useCallback, useRef } from 'react';
import {
  SyncRootDto,
  WebDavAccountDto,
  ConflictItemDto,
  TaskDto,
  HistoryItemDto,
  ConflictResolution,
  AiMergePreviewDto,
} from '../types/dto';
import { api } from '../services/api';
import { getErrorMessage } from '../services/errorMessage';

export type ActiveNav =
  | 'overview'
  | 'projects'
  | 'project_detail'
  | 'webdav'
  | 'conflicts'
  | 'history'
  | 'ai'
  | 'settings';

export interface AiMergeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AiMergeSession {
  conflictId: string;
  relativePath: string;
  status: 'idle' | 'merging' | 'ready' | 'applying' | 'error';
  preview: AiMergePreviewDto | null;
  suggestions: string;
  messages: AiMergeMessage[];
  error: string | null;
  isOpen: boolean;
}

export function needsFreshMerge(message: string | null) {
  return /LOCAL_FILE_CHANGED|DAV_PRECONDITION_FAILED|HASH_MISMATCH|AI_MERGE_PREVIEW_STALE|AI_MERGE_PREVIEW_EXPIRED/.test(message ?? '');
}

export function useSyncStore() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('projectsync-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'light';
  });

  const [currentNav, setCurrentNav] = useState<ActiveNav>('overview');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [roots, setRoots] = useState<SyncRootDto[]>([]);
  const [accounts, setAccounts] = useState<WebDavAccountDto[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItemDto[]>([]);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [history, setHistory] = useState<HistoryItemDto[]>([]);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bannerAlert, setBannerAlert] = useState<string | null>(null);
  const [aiSession, setAiSession] = useState<AiMergeSession | null>(null);
  const [aiMergeQueue, setAiMergeQueue] = useState<string[]>([]);
  const [mergeResults, setMergeResults] = useState({ applied: 0, skipped: 0, failed: 0 });
  const refreshInFlight = useRef(false);
  const progressByTaskId = useRef(new Map<string, number>());

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem('projectsync-theme', theme);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Load all data
  const refreshAll = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const results = await Promise.allSettled([
        api.listSyncRoots(),
        api.listWebDavAccounts(),
        api.listConflicts(),
        api.getPendingTasks(),
        api.querySyncHistory(),
      ]);
      const [rootsResult, accountsResult, conflictsResult, tasksResult, historyResult] = results;
      if (rootsResult.status === 'fulfilled') setRoots(rootsResult.value);
      if (accountsResult.status === 'fulfilled') setAccounts(accountsResult.value);
      if (conflictsResult.status === 'fulfilled') setConflicts(conflictsResult.value);
      if (tasksResult.status === 'fulfilled') {
        const activeIds = new Set(tasksResult.value.map((task) => task.id));
        for (const taskId of progressByTaskId.current.keys()) {
          if (!activeIds.has(taskId)) progressByTaskId.current.delete(taskId);
        }
        setTasks(tasksResult.value.map((task) => ({
          ...task,
          bytesTransferred: progressByTaskId.current.get(task.id) ?? task.bytesTransferred,
        })));
      }
      if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') console.error('Some ProjectSync data could not be refreshed', failed.reason);
    } catch (err: unknown) {
      console.error('Failed to refresh data', err);
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll();
    }, 6000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  useEffect(() => {
    if (!api.isTauri) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<{
        rootId: string;
        taskId: string;
        path: string;
        operation: TaskDto['action'];
        bytesTransferred: number;
        totalBytes: number;
      }>('sync://progress', ({ payload }) => {
        progressByTaskId.current.set(payload.taskId, payload.bytesTransferred);
        setTasks((current) => {
          const existing = current.find((task) => task.id === payload.taskId);
          if (existing) {
            return current.map((task) => task.id === payload.taskId
              ? { ...task, bytesTransferred: payload.bytesTransferred, totalBytes: payload.totalBytes }
              : task);
          }
          return [{
            id: payload.taskId,
            rootId: payload.rootId,
            path: payload.path,
            action: payload.operation,
            status: 'Running',
            bytesTransferred: payload.bytesTransferred,
            totalBytes: payload.totalBytes,
            retries: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }, ...current];
        });
      }))
      .then((stopListening) => {
        if (mounted) unlisten = stopListening;
        else stopListening();
      })
      .catch((error: unknown) => console.error('Failed to subscribe to transfer progress', error));
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const handleSyncNow = async (rootId: string) => {
    setRoots((prev) =>
      prev.map((r) => (r.id === rootId ? { ...r, status: 'SYNCING' } : r))
    );
    try {
      await api.syncNow(rootId);
    } catch (error: unknown) {
      setBannerAlert(`立即同步失败：${getErrorMessage(error, '同步请求失败')}`);
    } finally {
      await refreshAll();
    }
  };

  const handlePauseSync = async (rootId: string) => {
    setRoots((prev) =>
      prev.map((r) => (r.id === rootId ? { ...r, status: 'PAUSED' } : r))
    );
    try {
      await api.pauseSync(rootId);
    } catch (error: unknown) {
      setBannerAlert(`暂停同步失败：${getErrorMessage(error, '暂停请求失败')}`);
    } finally {
      await refreshAll();
    }
  };

  const handleResumeSync = async (rootId: string) => {
    setRoots((prev) =>
      prev.map((r) => (r.id === rootId ? { ...r, status: 'IDLE' } : r))
    );
    try {
      await api.resumeSync(rootId);
    } catch (error: unknown) {
      setBannerAlert(`恢复同步失败：${getErrorMessage(error, '恢复请求失败')}`);
    } finally {
      await refreshAll();
    }
  };

  const handleEnableSync = async (rootId: string) => {
    try {
      await api.enableSyncRoot(rootId);
      await refreshAll();
    } catch (error: unknown) {
      alert(getErrorMessage(error, '启用同步失败'));
    }
  };

  const handleRetryTask = async (taskId: string) => {
    try {
      await api.retryFailedTask(taskId);
      await refreshAll();
    } catch (error: unknown) {
      alert(getErrorMessage(error, '重试任务失败'));
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      await api.cancelSyncTask(taskId);
      await refreshAll();
    } catch (error: unknown) {
      setBannerAlert(`取消当前文件失败：${getErrorMessage(error, '取消任务失败')}`);
    }
  };

  const handleResolveConflict = async (conflictId: string, res: ConflictResolution) => {
    try {
      const resResult = await api.resolveConflict(conflictId, res);
      setBannerAlert(resResult.message);
      setTimeout(() => setBannerAlert(null), 7000);
      await refreshAll();
    } catch (e: unknown) {
      alert(getErrorMessage(e, '解决冲突失败'));
    }
  };

  const handleExcludeConflictFile = async (conflictId: string) => {
    try {
      const result = await api.excludeConflictFile(conflictId);
      setBannerAlert(result.message);
      setTimeout(() => setBannerAlert(null), 7000);
      await refreshAll();
    } catch (error: unknown) {
      setBannerAlert(`加入排除规则失败：${getErrorMessage(error, '更新排除规则失败')}`);
      throw error;
    }
  };

  const generateAiMerge = useCallback(async (conflict: Pick<ConflictItemDto, 'id' | 'relativePath'>, refresh = false) => {
    setAiSession({
      conflictId: conflict.id,
      relativePath: conflict.relativePath,
      status: 'merging',
      preview: null,
      suggestions: '',
      messages: [],
      error: null,
      isOpen: true,
    });

    try {
      const preview = await (refresh ? api.regenerateAiMerge(conflict.id) : api.previewAiMerge(conflict.id));
      const suggestions = preview.suggestions || '已自动完成双端差异智能合并，请审阅下方代码。';
      setAiSession((prev) => {
        if (!prev || prev.conflictId !== conflict.id) return prev;
        return {
          ...prev,
          status: 'ready',
          preview,
          suggestions,
          messages: [
            {
              id: 'init',
              role: 'assistant',
              content: suggestions,
              timestamp: Date.now(),
            },
          ],
        };
      });
    } catch (err: unknown) {
      const msg = getErrorMessage(err, '生成 AI 合并预览失败');
      setAiSession((prev) => {
        if (!prev || prev.conflictId !== conflict.id) return prev;
        return {
          ...prev,
          status: 'error',
          error: msg,
        };
      });
    }
  }, []);

  const enqueueAiMerges = (ids: string[]) => {
    if (!aiSession && aiMergeQueue.length === 0) setMergeResults({ applied: 0, skipped: 0, failed: 0 });
    setAiMergeQueue((queue) => [...new Set([
      ...queue,
      ...ids.filter((id) => id !== aiSession?.conflictId),
    ])]);
  };

  useEffect(() => {
    if (aiSession || aiMergeQueue.length === 0) return;
    const id = aiMergeQueue[0];
    const conflict = conflicts.find((item) => item.id === id && item.status === 'UNRESOLVED');
    setAiMergeQueue((queue) => queue.filter((item) => item !== id));
    if (conflict?.hasLocalVersion && conflict.hasRemoteVersion) void generateAiMerge(conflict);
    else setMergeResults((result) => ({ ...result, skipped: result.skipped + 1 }));
  }, [aiMergeQueue, aiSession, conflicts, generateAiMerge]);

  const refineAiMerge = async (instruction: string, currentContent?: string) => {
    if (aiSession?.status !== 'ready' || !aiSession.preview) return;
    const userMsg: AiMergeMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: instruction,
      timestamp: Date.now(),
    };

    setAiSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        status: 'merging',
        error: null,
        messages: [...prev.messages, userMsg],
      };
    });

    try {
      const updatedPreview = await api.refineAiMerge({
        conflictId: aiSession.conflictId,
        previewId: aiSession.preview.previewId,
        instruction,
        currentContent,
      });

      const assistantMsg: AiMergeMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: updatedPreview.suggestions || `已根据指令「${instruction}」调整合并结果。`,
        timestamp: Date.now(),
      };

      setAiSession((prev) => {
        if (!prev || prev.conflictId !== aiSession.conflictId) return prev;
        return {
          ...prev,
          status: 'ready',
          preview: updatedPreview,
          suggestions: updatedPreview.suggestions || prev.suggestions,
          messages: [...prev.messages, assistantMsg],
        };
      });
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'AI 调整合并内容失败');
      setAiSession((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          status: needsFreshMerge(msg) ? 'error' : 'ready',
          error: `调整失败: ${msg}`,
        };
      });
    }
  };

  const applyAiMerge = async (finalContent?: string) => {
    if (aiSession?.status !== 'ready' || !aiSession.preview) return;
    const { conflictId, preview } = aiSession;
    setAiSession((prev) => (prev ? { ...prev, status: 'applying' } : null));
    try {
      let activePreviewId = preview.previewId;
      if (finalContent !== undefined && finalContent !== preview.mergedContent) {
        // Direct save of manual user edits into preview without re-invoking the LLM
        const refined = await api.refineAiMerge({
          conflictId,
          previewId: preview.previewId,
          instruction: '__DIRECT_USER_EDIT__',
          currentContent: finalContent,
        });
        activePreviewId = refined.previewId;
      }
      const result = await api.applyAiMerge(conflictId, activePreviewId);
      if (!result.success) throw new Error(result.message);
      setMergeResults((counts) => ({ ...counts, applied: counts.applied + 1 }));
      setBannerAlert(result.message);
      setTimeout(() => setBannerAlert(null), 7000);
      await refreshAll();
      setAiSession(null);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, '写入本地与 WebDAV 失败');
      setAiSession((prev) => (prev ? { ...prev, status: needsFreshMerge(msg) ? 'error' : 'ready', error: msg } : null));
    }
  };

  const setAiSessionOpen = (isOpen: boolean) => {
    setAiSession((prev) => (prev ? { ...prev, isOpen } : null));
  };

  const cancelAiMerge = () => {
    if (!aiSession || aiSession.status === 'merging' || aiSession.status === 'applying') return;
    const key = aiSession.status === 'error' ? 'failed' : 'skipped';
    setMergeResults((counts) => ({ ...counts, [key]: counts[key] + 1 }));
    setAiSession(null);
  };

  const regenerateAiMerge = async () => {
    if (aiSession?.status !== 'error') return;
    await generateAiMerge({ id: aiSession.conflictId, relativePath: aiSession.relativePath }, needsFreshMerge(aiSession.error));
  };

  const handlePreviewAiMerge = async (conflictId: string): Promise<AiMergePreviewDto> => {
    return api.previewAiMerge(conflictId);
  };

  const handleApplyAiMerge = async (conflictId: string, previewId: string) => {
    const result = await api.applyAiMerge(conflictId, previewId);
    setBannerAlert(result.message);
    setTimeout(() => setBannerAlert(null), 7000);
    await refreshAll();
  };

  const openProjectDetail = (rootId: string) => {
    setSelectedProjectId(rootId);
    setCurrentNav('project_detail');
  };

  return {
    theme,
    toggleTheme,
    currentNav,
    setCurrentNav,
    selectedProjectId,
    setSelectedProjectId,
    openProjectDetail,
    roots,
    accounts,
    conflicts,
    tasks,
    history,
    isWizardOpen,
    setIsWizardOpen,
    loading,
    bannerAlert,
    setBannerAlert,
    refreshAll,
    handleSyncNow,
    handlePauseSync,
    handleResumeSync,
    handleEnableSync,
    handleRetryTask,
    handleCancelTask,
    handleResolveConflict,
    handleExcludeConflictFile,
    handlePreviewAiMerge,
    handleApplyAiMerge,
    aiSession,
    aiMergeQueue,
    mergeResults,
    regenerateAiMerge,
    enqueueAiMerges,
    clearAiMergeQueue: () => {
      setMergeResults((counts) => ({ ...counts, skipped: counts.skipped + aiMergeQueue.length }));
      setAiMergeQueue([]);
    },
    refineAiMerge,
    applyAiMerge,
    setAiSessionOpen,
    cancelAiMerge,
  };
}
