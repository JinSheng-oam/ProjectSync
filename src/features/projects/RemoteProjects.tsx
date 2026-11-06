import { useEffect, useState } from 'react';
import { Button } from '../../components/common/UIComponents';
import { DiscoveredProject, SyncRootDto, WebDavAccountDto } from '../../types/dto';

export function RemoteProjects({ accounts, roots, onBind }: { accounts: WebDavAccountDto[]; roots: SyncRootDto[]; onBind: (project: DiscoveredProject) => void }) {
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const accountKey = JSON.stringify(accounts.map(({ id, name }) => ({ id, name })));
  useEffect(() => {
    const discoveryAccounts = JSON.parse(accountKey) as { id: string; name: string }[];
    if (!discoveryAccounts.length) { setProjects([]); setErrors([]); setBusy(false); return; }
    let cancelled = false;
    setBusy(true); setErrors([]);
    Promise.all(discoveryAccounts.map(async account => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return { projects: await invoke<DiscoveredProject[]>('discover_remote_projects', { accountId: account.id }), error: '' };
      } catch (e: unknown) { return { projects: [], error: `${account.name}：${typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e)}` }; }
    })).then(results => { if (!cancelled) { setProjects(results.flatMap(r => r.projects)); setErrors(results.map(r => r.error).filter(Boolean)); setBusy(false); } });
    return () => { cancelled = true; };
  }, [accountKey, version]);
  const pending = projects.filter(p => !roots.some(r => (p.remoteProjectId && r.remoteProjectId === p.remoteProjectId) || (r.accountId === p.accountId && r.remotePath.replace(/\/+$/, '') === p.remotePath.replace(/\/+$/, ''))));
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
    <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">其他设备的项目</h3><p className="mt-1 text-xs text-slate-500">从已配置的 WebDAV 节点查找尚未在本机绑定的项目。</p></div><Button variant="secondary" size="sm" disabled={busy} onClick={() => setVersion(v => v + 1)}>{busy ? '查找中…' : '刷新'}</Button></div>
    {errors.map(error => <p role="alert" key={error} className="text-xs text-rose-700 dark:text-rose-300">{error}</p>)}
    {pending.map(p => <div key={`${p.accountId}:${p.remotePath}`} className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-xs dark:border-slate-800"><div className="min-w-0"><div className="font-semibold">{p.name}</div><div className="break-all text-slate-500">{accounts.find(a => a.id === p.accountId)?.name} · {p.remotePath}{!p.remoteProjectId && ' · 远端目录'}</div></div><Button variant="secondary" size="sm" onClick={() => onBind(p)}>绑定到此电脑</Button></div>)}
    {!busy && !errors.length && !pending.length && <p className="text-xs text-slate-500">{accounts.length ? '没有发现待绑定的项目。' : '添加 WebDAV 节点后可查找远端项目。'}</p>}
  </section>;
}
