import { useState, useEffect, useCallback } from 'react';
import {
  SyncRootDto,
  WebDavAccountDto,
  ConflictItemDto,
  TaskDto,
  HistoryItemDto,
  ConflictResolution,
} from '../types/dto';
import { api } from '../services/api';

export type ActiveNav =
  | 'overview'
  | 'projects'
  | 'project_detail'
  | 'webdav'
  | 'conflicts'
  | 'history'
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
    try {
      const [rList, aList, cList, tList, hList] = await Promise.all([
        api.listSyncRoots(),
        api.listWebDavAccounts(),
        api.listConflicts(),
        api.getPendingTasks(),
        api.querySyncHistory(),
      ]);
      setRoots(rList);
      setAccounts(aList);
      setConflicts(cList);
      setTasks(tList);
      setHistory(hList);
    } catch (err: unknown) {
      console.error('Failed to refresh data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 6000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  const handleSyncNow = async (rootId: string) => {
    setRoots((prev) =>
      prev.map((r) => (r.id === rootId ? { ...r, status: 'SYNCING' } : r))
    );
    await api.syncNow(rootId);
    await refreshAll();
  };

  const handlePauseSync = async (rootId: string) => {
    setRoots((prev) =>
      prev.map((r) => (r.id === rootId ? { ...r, status: 'PAUSED' } : r))
    );
    await api.pauseSync(rootId);
    await refreshAll();
  };

  const handleResumeSync = async (rootId: string) => {
    setRoots((prev) =>
      prev.map((r) => (r.id === rootId ? { ...r, status: 'IDLE' } : r))
    );
    await api.resumeSync(rootId);
    await refreshAll();
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
  };
}
