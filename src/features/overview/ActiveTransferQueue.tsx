import { ArrowUpRight, ArrowDownLeft, ShieldCheck, Clock, RefreshCw } from 'lucide-react';
import { TaskDto } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';

export function ActiveTransferQueue({ tasks, onRetryTask }: { tasks: TaskDto[]; onRetryTask: (taskId: string) => void }) {
  const visibleTasks = tasks.filter((task) => task.status !== 'Succeeded' && task.status !== 'Cancelled');
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
            <span>当前没有正在传输的文件，两端保持一致</span>
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
    </div>
  );
}
