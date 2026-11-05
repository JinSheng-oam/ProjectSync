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

export type ActiveNav =
  | 'overview'
  | 'projects'
  | 'project_detail'
  | 'webdav'
  | 'conflicts'
  | 'history'
  | 'ai'
  | 'settings';

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
      setBannerAlert(`立即同步失败：${error instanceof Error ? error.message : String(error)}`);
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
      setBannerAlert(`暂停同步失败：${error instanceof Error ? error.message : String(error)}`);
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
      setBannerAlert(`恢复同步失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await refreshAll();
    }
  };

  const handleEnableSync = async (rootId: string) => {
    try {
      await api.enableSyncRoot(rootId);
      await refreshAll();
    } catch (error: unknown) {
      alert((error as Error).message);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    try {
      await api.retryFailedTask(taskId);
      await refreshAll();
    } catch (error: unknown) {
      alert((error as Error).message);
    }
  };

  const handleResolveConflict = async (conflictId: string, res: ConflictResolution) => {
    try {
      const resResult = await api.resolveConflict(conflictId, res);
      setBannerAlert(resResult.message);
      setTimeout(() => setBannerAlert(null), 7000);
      await refreshAll();
    } catch (e: unknown) {
      alert((e as Error).message);
    }
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
    handleResolveConflict,
    handlePreviewAiMerge,
    handleApplyAiMerge,
  };
}
