import { useState } from 'react';
import { Archive } from 'lucide-react';
import { SelectMenu } from '../../components/common/SelectMenu';
import { Button, Modal } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { getErrorMessage } from '../../services/errorMessage';
import { RemoteCleanupInventory, RemoteCleanupItem, SyncRootDto } from '../../types/dto';

const LIMIT = 200;
const sizeText = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};
const sumSize = (items: RemoteCleanupItem[]) => sizeText(items.reduce((sum, item) => sum + item.size, 0));

export function RemoteBackupCleanup({ roots }: { roots: SyncRootDto[] }) {
  const [selection, setSelection] = useState('');
  const rootId = roots.some((root) => root.id === selection) ? selection : roots[0]?.id ?? '';
  const [inventory, setInventory] = useState<(RemoteCleanupInventory & { rootId: string }) | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<RemoteCleanupItem[] | null>(null);
  const [busy, setBusy] = useState<'scan' | 'clean' | null>(null);
  const [error, setError] = useState('');
  const [report, setReport] = useState('');
  const [failures, setFailures] = useState<Map<string, string>>(() => new Map());
  const current = inventory?.rootId === rootId ? inventory : null;
  const files = current?.files ?? [];
  const eligible = current?.canAttemptCleanup ? files.filter((file) => file.etag) : [];
  const chosen = eligible.filter((file) => selected.has(file.path));
  const firstBatch = eligible.slice(0, LIMIT);

  const scan = async () => {
    setBusy('scan');
    setError('');
    setReport('');
    setFailures(new Map());
    setInventory(null);
    setSelected(new Set());
    try {
      setInventory({ ...await api.listRemoteCleanup(rootId), rootId });
    } catch (error) {
      setError(getErrorMessage(error, '读取远端备份失败'));
    } finally {
      setBusy(null);
    }
  };

  const clean = async () => {
    if (!confirm) return;
    setConfirm(null);
    setBusy('clean');
    setError('');
    setReport('');
    setFailures(new Map());
    try {
      const result = await api.cleanRemoteBackups(rootId, confirm);
      const removed = new Set(result.removed);
      setInventory((previous) => previous && { ...previous, files: previous.files.filter((file) => !removed.has(file.path)) });
      setSelected(new Set(result.failures.map(([path]) => path)));
      setFailures(new Map(result.failures));
      setReport(`已清理 ${removed.size} 项（${sumSize(confirm.filter((file) => removed.has(file.path)))}）${result.failures.length ? `，${result.failures.length} 项未清理` : ''}。`);
    } catch (error) {
      setError(getErrorMessage(error, '远端清理失败'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Archive aria-hidden="true" className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          WebDAV 备份与遗留文件
        </h3>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">扫描所选项目的远端回收站和历史冲突副本。普通同步文件不参与清理。</p>
      </div>
      <fieldset disabled={busy !== null || !rootId} className="flex min-w-0 flex-wrap items-center gap-2">
        <SelectMenu label="同步项目" value={rootId} options={roots.map((root) => ({ value: root.id, label: root.name }))}
          onChange={(id) => { setSelection(id); setInventory(null); setSelected(new Set()); setError(''); setReport(''); setFailures(new Map()); }} />
        <Button variant="secondary" size="sm" disabled={busy !== null || !rootId} onClick={scan}>{busy === 'scan' ? '正在扫描…' : '扫描远端备份'}</Button>
      </fieldset>
      {!rootId && <p className="text-xs text-slate-600 dark:text-slate-300">绑定同步项目后可以扫描。</p>}
      {error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
      {report && <p role="status" className="text-xs text-slate-700 dark:text-slate-200">{report}</p>}
      {current && (
        <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          {current.truncated && <p className="text-xs text-amber-800 dark:text-amber-300">已达到扫描上限，仅显示本次找到的文件。</p>}
          {files.length === 0 ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">本次未发现可列出的备份或遗留文件。</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span>{files.length} 项 · {sumSize(files)}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {firstBatch.length > 0 && (
                    <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setSelected(
                      chosen.length === firstBatch.length ? new Set() : new Set(firstBatch.map((file) => file.path))
                    )}>{chosen.length === firstBatch.length ? '取消选择' : eligible.length > LIMIT ? '选择前 200 项' : '全选可清理项'}</Button>
                  )}
                  <Button variant="danger" size="sm" disabled={!chosen.length || busy !== null} onClick={() => setConfirm(chosen)}>
                    {busy === 'clean' ? '正在清理…' : `清理所选（${chosen.length}）`}
                  </Button>
                </div>
              </div>
              {!current.canAttemptCleanup && <p className="text-xs text-slate-600 dark:text-slate-300">该节点目前不能验证受保护删除。可以查看列表，文件将保留。</p>}
              <ul aria-label="远端备份列表" className="max-h-80 divide-y divide-slate-200 overflow-auto border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {files.map((file) => (
                  <li key={file.path} className="space-y-1 px-1 py-2 text-xs">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5 shrink-0" checked={selected.has(file.path)}
                        disabled={busy !== null || !file.etag || !current.canAttemptCleanup || (chosen.length >= LIMIT && !selected.has(file.path))}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (checked) next.add(file.path); else next.delete(file.path);
                            return next;
                          });
                        }} />
                      <span className="min-w-0 flex-1">
                        <code className="break-all text-slate-900 dark:text-slate-100">{file.path}</code>
                        <span className="mt-1 block text-slate-600 dark:text-slate-300">
                          {file.kind === 'trash' ? '回收站备份' : '历史冲突副本'} · {sizeText(file.size)}
                          {file.modifiedAt > 0 && ` · ${new Date(file.modifiedAt).toLocaleString()}`}
                          {!file.etag && ' · 缺少可用的版本标识，不能清理'}
                        </span>
                      </span>
                    </label>
                    {failures.has(file.path) && <p className="pl-6 text-rose-700 dark:text-rose-300">{failures.get(file.path)}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <Modal isOpen={confirm !== null} onClose={() => setConfirm(null)} title="永久删除所选远端备份？"
        footer={<>
          <Button variant="secondary" onClick={() => setConfirm(null)}>取消</Button>
          <Button variant="danger" onClick={clean}>永久删除</Button>
        </>}>
        <p className="text-sm text-slate-700 dark:text-slate-200">将清理 {confirm?.length ?? 0} 项（{sumSize(confirm ?? [])}）。删除后无法从 ProjectSync 回收站恢复。</p>
      </Modal>
    </section>
  );
}
