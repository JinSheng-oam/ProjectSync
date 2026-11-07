import {
  FolderGit2,
  Server,
  AlertTriangle,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { ProjectSummaryCard } from './ProjectSummaryCard';
import { ActiveTransferQueue } from './ActiveTransferQueue';
import { SyncRootDto, ConflictItemDto, WebDavAccountDto, TaskDto } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';
import { ActiveNav } from '../../stores/syncStore';
import emptySyncIllustration from '../../assets/empty-sync-indigo.png';

interface OverviewDashboardProps {
  roots: SyncRootDto[];
  conflicts: ConflictItemDto[];
  accounts: WebDavAccountDto[];
  tasks: TaskDto[];
  onNavigate: (nav: ActiveNav) => void;
  onOpenDetail: (rootId: string) => void;
  onOpenWizard: () => void;
  onSyncNow: (rootId: string) => void;
  onPause: (rootId: string) => void;
  onResume: (rootId: string) => void;
  onEnable: (rootId: string) => void;
  onRetryTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
}

export function OverviewDashboard({
  roots,
  conflicts,
  accounts,
  tasks,
  onNavigate,
  onOpenDetail,
  onOpenWizard,
  onSyncNow,
  onPause,
  onResume,
  onEnable,
  onRetryTask,
  onCancelTask,
}: OverviewDashboardProps) {
  const unresolvedConflicts = conflicts.filter((c) => c.status === 'UNRESOLVED');
  const onlineAccounts = accounts.filter((a) => a.status === 'ONLINE');
  const activeTasks = tasks.filter((t) => t.status === 'Running' || t.status === 'Pending');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Telemetry Status Ribbon */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-soft-sm divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800 transition-colors">
        <div className="p-5">
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs font-medium">
            <span>同步项目</span>
            <FolderGit2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{roots.length}</span>
            <span className="text-xs text-slate-600 dark:text-slate-400">个目录</span>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs font-medium">
            <span>WebDAV 节点</span>
            <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{onlineAccounts.length}</span>
            <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium font-mono">/{accounts.length} 在线</span>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs font-medium">
            <span>正在传输</span>
            <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{activeTasks.length}</span>
            <span className="text-xs text-slate-600 dark:text-slate-400">个活动文件</span>
          </div>
        </div>

        <div
          onClick={() => onNavigate('conflicts')}
          className={`p-5 cursor-pointer transition-colors ${
            unresolvedConflicts.length > 0
              ? 'bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-950/50'
              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
          }`}
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs font-medium">
            <span className={unresolvedConflicts.length > 0 ? 'text-amber-900 dark:text-amber-200 font-semibold' : ''}>
              待解决冲突
            </span>
            <AlertTriangle
              className={`w-4 h-4 ${unresolvedConflicts.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}
            />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span
              className={`font-mono text-2xl font-semibold tabular-nums ${
                unresolvedConflicts.length > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {unresolvedConflicts.length}
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {unresolvedConflicts.length > 0 ? '处需要裁决' : '完全一致'}
            </span>
          </div>
        </div>
      </div>

      {/* Prominent Conflict Interception Banner if any */}
      {unresolvedConflicts.length > 0 && (
        <div className="bg-amber-50/90 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-2xl p-4 flex items-center justify-between shadow-soft-sm transition-colors">
          <div className="flex items-center gap-3.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-950 dark:text-amber-100 flex items-center gap-2">
                <span>发现 {unresolvedConflicts.length} 处双向修改冲突</span>
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/80 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-medium">
                  安全拦截中
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onNavigate('conflicts')}
            className="shrink-0 bg-amber-700 hover:bg-amber-800 text-white border-amber-700 gap-1.5"
          >
            <span>处理冲突</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Project Grid */}
      <div className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>同步项目</span>
            <span className="text-xs text-slate-600 dark:text-slate-400 font-mono font-normal">({roots.length})</span>
          </h2>
          <Button variant="primary" size="sm" onClick={onOpenWizard}>
            + 添加项目
          </Button>
        </div>

        {roots.length === 0 ? (
          <div className="min-h-[340px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-10 py-8 text-center flex flex-col items-center justify-center shadow-soft-sm transition-colors">
            <img src={emptySyncIllustration} alt="" className="w-52 h-32 object-contain mb-3" />
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">暂无同步项目</h3>
            </div>
            <Button variant="primary" size="md" onClick={onOpenWizard} className="mt-4 px-5">
              <span>+ 添加同步项目</span>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {roots.map((root) => (
              <ProjectSummaryCard
                key={root.id}
                root={root}
                onOpenDetail={onOpenDetail}
                onSyncNow={onSyncNow}
                onPause={onPause}
                onResume={onResume}
                onEnable={onEnable}
              />
            ))}
          </div>
        )}
      </div>

      {/* Live Transfer Telemetry Queue */}
      <ActiveTransferQueue tasks={tasks} onRetryTask={onRetryTask} onCancelTask={onCancelTask} />
    </div>
  );
}
