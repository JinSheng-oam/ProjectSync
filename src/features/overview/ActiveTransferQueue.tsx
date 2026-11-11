import { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, ChevronRight, ShieldCheck, Clock, RefreshCw, X } from 'lucide-react';
import { SyncRootDto, TaskDto } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { getErrorMessage } from '../../services/errorMessage';

function remoteFileRetained(task: TaskDto) {
  return (task.status === 'Blocked' || task.status === 'Failed') &&
    task.errorCode === 'BLOCKED_SERVER_CAPABILITY' &&
    (task.action === 'MoveRemoteToTrash' ||
      (task.action === 'Blocked' && /受保护的 MOVE|保护的远端 MOVE|远端文件没有可用的强 ETag/.test(task.error ?? '')));
}

const retainedKey = (task: TaskDto) => JSON.stringify([task.rootId, task.path.toLowerCase()]);

export function ActiveTransferQueue({ tasks, roots, onRetryTask, onRefresh, onCancelTask, onOpenWebDav }: { tasks: TaskDto[]; roots: SyncRootDto[]; onRetryTask: (taskId: string) => void; onRefresh: () => Promise<void>; onCancelTask: (taskId: string) => void; onOpenWebDav: () => void }) {
  const [handling, setHandling] = useState<{ ids: string[]; restore: boolean } | null>(null);
  const [retainedErrors, setRetainedErrors] = useState<Map<string, string>>(() => new Map());
  const [handledIds, setHandledIds] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const handleRetained = async (items: TaskDto[], restore: boolean) => {
    setHandling({ ids: items.map((task) => task.id), restore });
    setRetainedErrors(new Map());
    try {
      for (const task of items) {
        try {
          await api.handleRetainedRemoteFile(task.id, restore);
          const key = retainedKey(task);
          setHandledIds((previous) => new Set([
            ...previous,
            ...tasks.filter((row) => remoteFileRetained(row) && retainedKey(row) === key).map((row) => row.id),
          ]));
          setSelected((previous) => new Set([...previous].filter((id) => id !== task.id)));
        } catch (error) {
          setRetainedErrors((previous) => new Map(previous).set(task.id, getErrorMessage(error, restore ? '恢复本地文件失败' : '确认失败')));
        }
      }
      await onRefresh();
    } finally {
      setHandling(null);
    }
  };
  const visibleTasks: TaskDto[] = [];
  const retained = new Map<string, TaskDto>();
  for (const task of tasks) {
    if (task.status === 'Succeeded' || task.status === 'Cancelled') continue;
    if (remoteFileRetained(task)) {
      if (handledIds.has(task.id)) continue;
      const key = retainedKey(task);
      if (!retained.has(key)) retained.set(key, task);
    } else {
      visibleTasks.push(task);
    }
  }
  const projectNames = new Map(roots.map((root) => [root.id, root.name]));
  const selectedTasks = [...retained.values()].filter((task) => selected.has(task.id));
  const activeCount = visibleTasks.filter((task) => task.status === 'Running' || task.status === 'Pending' || task.status === 'RetryWait').length;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-soft-sm transition-colors">
      <div className="flex items-center justify-between pb-3.5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${activeCount > 0 ? 'bg-indigo-600 dark:bg-indigo-400 ring-2 ring-indigo-100 dark:ring-indigo-950' : 'bg-slate-400 dark:bg-slate-600'}`} />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">传输队列</h2>
          <span className="text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/80 px-2.5 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800 font-medium font-mono">
            {activeCount} 个活动任务
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>BLAKE3 完整性校验 · 原子写入保护</span>
        </div>
      </div>

      <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {visibleTasks.length === 0 ? (
          <div className="py-8 text-center text-slate-600 dark:text-slate-400 text-xs flex flex-col items-center justify-center gap-1.5">
            <Clock className="w-5 h-5 text-slate-400 dark:text-slate-600 mb-1" />
            <span>当前没有传输任务</span>
          </div>
        ) : (
          visibleTasks.map((task) => {
            const isUpload = task.action.startsWith('Upload');
            const percent = task.totalBytes > 0 ? Math.round((task.bytesTransferred / task.totalBytes) * 100) : 0;

            return (
              <div
                key={task.id}
                className="py-3 first:pt-1 last:pb-1 space-y-2 group transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      className={`p-1 rounded-md font-mono text-xs shrink-0 ${
                        isUpload
                          ? 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                          : 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      }`}
                    >
                      {isUpload ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                      )}
                    </span>
                    <span className="font-mono text-xs text-slate-900 dark:text-slate-100 truncate font-medium">
                      {task.path}
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0 border border-slate-200 dark:border-slate-700">
                      {task.action}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-xs shrink-0">
                    <span className="text-slate-600 dark:text-slate-400">
                      {(task.bytesTransferred / 1024).toFixed(1)} / {(task.totalBytes / 1024).toFixed(1)} KB
                    </span>
                    {task.status === 'Failed' || task.status === 'Blocked' ? (
                      <Button variant="secondary" size="sm" onClick={() => onRetryTask(task.id)} className="gap-1">
                        <RefreshCw className="w-3 h-3" /> 重试
                      </Button>
                    ) : task.status === 'Running' && (task.action.startsWith('Upload') || task.action.startsWith('Download')) ? (
                      <Button variant="secondary" size="sm" onClick={() => onCancelTask(task.id)} className="gap-1 text-rose-700 dark:text-rose-300">
                        <X className="w-3 h-3" /> 取消此文件
                      </Button>
                    ) : (
                      <span className="text-indigo-700 dark:text-indigo-300 font-semibold w-12 text-right">
                        {task.status === 'RetryWait' ? '等待' : `${percent}%`}
                      </span>
                    )}
                  </div>
                </div>

                {task.error && (
                  <div className="text-xs text-rose-700 dark:text-rose-400 font-mono">
                    {task.errorCode ? `${task.errorCode}: ` : ''}{task.error}
                  </div>
                )}

                {/* Transfer progress bar */}
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
                  <div
                    className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
      {retained.size > 0 && (
        <details className="group/retained mt-3 border-t border-slate-200 pt-2 dark:border-slate-800">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-slate-300 dark:hover:text-slate-100 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 group-open/retained:rotate-90" />
            <span>远端保留了 {retained.size} 个已在本地删除的文件</span>
          </summary>
          <div className="space-y-2 pb-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
            <p>远端文件仍在。误删可恢复到原位置；确认只关闭这条提醒。</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={selectedTasks.length === retained.size} disabled={handling !== null}
                  onChange={(event) => setSelected(new Set(event.target.checked ? [...retained.values()].map((task) => task.id) : []))} />
                全选（已选 {selectedTasks.length}）
              </label>
              <Button variant="secondary" size="sm" disabled={!selectedTasks.length || handling !== null} onClick={() => handleRetained(selectedTasks, true)}>批量恢复</Button>
              <Button variant="ghost" size="sm" disabled={!selectedTasks.length || handling !== null} onClick={() => handleRetained(selectedTasks, false)}>批量确认</Button>
            </div>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {Array.from(retained, ([key, task]) => (
                <li key={key} className="border-b border-slate-100 py-2 last:border-b-0 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-w-0 items-baseline gap-2">
                      <input type="checkbox" className="shrink-0" checked={selected.has(task.id)} disabled={handling !== null}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (checked) next.add(task.id); else next.delete(task.id);
                            return next;
                          });
                        }} />
                      <span className="min-w-0">
                      {projectNames.get(task.rootId) && <span className="mr-2">{projectNames.get(task.rootId)}</span>}
                      <code className="break-all text-slate-800 dark:text-slate-100">{task.path}</code>
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="secondary" size="sm" disabled={handling !== null} onClick={() => handleRetained([task], true)}>
                        {handling?.ids.includes(task.id) && handling.restore ? '恢复中…' : '恢复到本地'}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={handling !== null} onClick={() => handleRetained([task], false)}>
                        {handling?.ids.includes(task.id) && !handling.restore ? '确认中…' : '确认，不再提醒'}
                      </Button>
                    </div>
                  </div>
                  {retainedErrors.has(task.id) && (
                    <p role="alert" className="mt-1.5 break-words text-rose-700 dark:text-rose-400">{retainedErrors.get(task.id)}</p>
                  )}
                </li>
              ))}
            </ul>
            <Button variant="secondary" size="sm" onClick={onOpenWebDav}>查看 WebDAV 节点</Button>
          </div>
        </details>
      )}
    </div>
  );
}
