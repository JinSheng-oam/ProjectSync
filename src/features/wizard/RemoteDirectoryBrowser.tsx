import { useEffect, useState } from 'react';
import { Cloud, FolderOpen, ArrowUp } from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';

import { getErrorCode, getErrorMessage } from './wizardErrors';

export function useRemoteDirectory(active: boolean, selectedAccountId: string) {
  const [remoteBrowsePath, setRemoteBrowsePath] = useState('/');
  const [remoteEntries, setRemoteEntries] = useState<Awaited<ReturnType<typeof api.browseRemoteDirectory>>>([]);
  const [remoteBrowseLoaded, setRemoteBrowseLoaded] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteBrowseError, setRemoteBrowseError] = useState<string | null>(null);
  const [remoteBrowseRefresh, setRemoteBrowseRefresh] = useState(0);

  useEffect(() => {
    if (!active || !selectedAccountId) return;
    let cancelled = false;
    setLoadingRemote(true);
    setRemoteBrowseError(null);
    setRemoteBrowseLoaded(false);
    setRemoteEntries([]);
    api.browseRemoteDirectory(selectedAccountId, remoteBrowsePath).then((entries) => {
      if (!cancelled) { setRemoteEntries(entries); setRemoteBrowseLoaded(true); }
    }).catch((error: unknown) => {
      if (!cancelled) setRemoteBrowseError(getErrorCode(error) === 'DAV_NOT_FOUND' ? '该目录不存在，请返回上级目录。' : getErrorMessage(error));
    }).finally(() => { if (!cancelled) setLoadingRemote(false); });
    return () => { cancelled = true; };
  }, [active, selectedAccountId, remoteBrowsePath, remoteBrowseRefresh]);

  return { remoteBrowsePath, setRemoteBrowsePath, remoteEntries, remoteBrowseLoaded, loadingRemote, remoteBrowseError, setRemoteBrowseRefresh };
}

export function RemoteDirectoryBrowser({ browse, selectedAccountId, onSelect }: { browse: ReturnType<typeof useRemoteDirectory>; selectedAccountId: string; onSelect: (path: string) => void }) {
  const { remoteBrowsePath, setRemoteBrowsePath, remoteEntries, remoteBrowseLoaded, loadingRemote, remoteBrowseError, setRemoteBrowseRefresh } = browse;
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 bg-slate-50 dark:bg-slate-800/50 space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-slate-100">
        <span className="flex items-center gap-1.5">
          <Cloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          远端目录浏览
        </span>
        <div className="flex items-center gap-2">
          <code className="text-[11px] text-slate-600 dark:text-slate-400">{remoteBrowsePath}</code>
          <button type="button" onClick={() => setRemoteBrowsePath(parentRemoteDirectory(remoteBrowsePath))} disabled={remoteBrowsePath === '/'} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40" aria-label="上级目录">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <Button variant="secondary" size="sm" onClick={() => setRemoteBrowseRefresh((value) => value + 1)} disabled={loadingRemote || !selectedAccountId} className="gap-1">
            <FolderOpen className="w-3.5 h-3.5" />{loadingRemote ? '读取中' : '刷新'}
          </Button>
        </div>
      </div>
      {!selectedAccountId && (
        <div role="alert" className="text-[11px] text-amber-700 dark:text-amber-400">
          尚未选择 WebDAV 节点，请返回第 1 步选择连接后再浏览。
        </div>
      )}
      {remoteBrowseError && <div role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">{remoteBrowseError}</div>}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 font-mono text-xs text-slate-700 dark:text-slate-300 space-y-1 max-h-40 overflow-y-auto">
        {remoteEntries.length === 0 ? <div className="text-slate-500">{loadingRemote ? '正在读取远端目录…' : remoteBrowseLoaded ? '此目录为空。' : remoteBrowseError ? '无法读取目录。' : '正在准备读取远端目录。'}</div> : remoteEntries.map((entry) => (
          <button key={entry.path} type="button" disabled={!entry.isCollection} onClick={() => setRemoteBrowsePath(entry.path)} className="w-full text-left rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
            {entry.isCollection ? '📁' : '📄'} {entry.name || '/'}{entry.isCollection ? '/' : ''}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" disabled={!remoteBrowseLoaded || loadingRemote} onClick={() => { onSelect(remoteBrowsePath); }} className="text-indigo-700 dark:text-indigo-300">使用当前远端目录：{remoteBrowsePath}</Button>
    </div>
  );
}

function parentRemoteDirectory(path: string): string {
  const normalized = path.trim().replace(/\/+$/, '') || '/';
  const separator = normalized.lastIndexOf('/');
  return separator <= 0 ? '/' : normalized.slice(0, separator);
}
