import { ArrowUpRight, ArrowDownLeft, ShieldCheck, Clock, RefreshCw } from 'lucide-react';
import { TaskDto } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';

export function ActiveTransferQueue({ tasks, onRetryTask }: { tasks: TaskDto[]; onRetryTask: (taskId: string) => void }) {
  const visibleTasks = tasks.filter((task) => task.status !== 'Succeeded' && task.status !== 'Cancelled');
  const activeCount = visibleTasks.filter((task) => task.status === 'Running' || task.status === 'Pending' || task.status === 'RetryWait').length;

  return (
    <div className="bg-white/50 dark:bg-aerospace-surface/60 backdrop-blur-xl border border-white/70 dark:border-aerospace-border rounded-2xl p-6 shadow-soft-sm">
      <div className="flex items-center justify-between pb-3 border-b border-aerospace-border">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${activeCount > 0 ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">传输队列</h2>
          <span className="text-sm text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950 px-3 py-1 rounded-full border border-indigo-200 dark:border-indigo-800 font-medium">
            <span className="font-mono">{activeCount}</span> 个活动任务
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>BLAKE3 完整性校验 · 原子写入保护</span>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {visibleTasks.length === 0 ? (
          <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm flex flex-col items-center justify-center gap-1.5">
            <Clock className="w-6 h-6 text-indigo-300 dark:text-indigo-700 mb-1" />
            <span>当前没有正在传输的文件，两端保持一致</span>
          </div>
        ) : (
          visibleTasks.map((task) => {
            const isUpload = task.action.startsWith('Upload');
            const percent = task.totalBytes > 0 ? Math.round((task.bytesTransferred / task.totalBytes) * 100) : 0;

            return (
              <div
                key={task.id}
                className="bg-slate-50 dark:bg-aerospace-canvas/60 border border-slate-200 dark:border-aerospace-border rounded-lg p-3 space-y-2 hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`p-1 rounded font-mono text-xs ${
                        isUpload
                          ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-800'
                          : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
                      }`}
                    >
                      {isUpload ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                      )}
                    </span>
                    <span className="font-mono text-xs text-slate-800 dark:text-slate-200 truncate font-medium">
                      {task.path}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      {task.action}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-xs shrink-0">
                    <span className="text-slate-500 dark:text-slate-400">
                      {(task.bytesTransferred / 1024).toFixed(1)} / {(task.totalBytes / 1024).toFixed(1)} KB
                    </span>
                    {task.status === 'Failed' || task.status === 'Blocked' ? (
                      <Button variant="secondary" size="sm" onClick={() => onRetryTask(task.id)} className="gap-1">
                        <RefreshCw className="w-3 h-3" /> 重试
                      </Button>
                    ) : <span className="text-indigo-600 dark:text-indigo-400 font-semibold w-10 text-right">{task.status === 'RetryWait' ? '等待' : `${percent}%`}</span>}
                  </div>
                </div>

                {task.error && <div className="text-[11px] text-rose-700 dark:text-rose-300">{task.errorCode ? `${task.errorCode}: ` : ''}{task.error}</div>}

                {/* Transfer progress */}
                <div className="w-full bg-slate-200 dark:bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-300 dark:border-slate-800">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
