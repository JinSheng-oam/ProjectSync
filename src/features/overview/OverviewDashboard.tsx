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
}: OverviewDashboardProps) {
  const unresolvedConflicts = conflicts.filter((c) => c.status === 'UNRESOLVED');
  const onlineAccounts = accounts.filter((a) => a.status === 'ONLINE');
  const activeTasks = tasks.filter((t) => t.status === 'Running' || t.status === 'Pending');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Flight Telemetry Status Metric Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-3.5 shadow-soft-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>同步项目</span>
            <FolderGit2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100">{roots.length}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">个目录</span>
          </div>
        </div>

        <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-3.5 shadow-soft-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>WebDAV 节点</span>
            <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100">{onlineAccounts.length}</span>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium font-mono">/{accounts.length} 在线</span>
          </div>
        </div>

        <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-3.5 shadow-soft-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>正在传输</span>
            <Zap className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-cyan-600 dark:text-cyan-400">{activeTasks.length}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">个文件</span>
          </div>
        </div>

        <div
          onClick={() => onNavigate('conflicts')}
          className={`border rounded-xl p-3.5 shadow-soft-sm cursor-pointer transition-colors ${
            unresolvedConflicts.length > 0
              ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-600/70 hover:bg-amber-100/80 dark:hover:bg-amber-950/60 shadow-glow-amber'
              : 'bg-aerospace-surface border-aerospace-border'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span className={unresolvedConflicts.length > 0 ? 'text-amber-800 dark:text-amber-400 font-semibold' : ''}>
              待解决冲突
            </span>
            <AlertTriangle
              className={`w-4 h-4 ${unresolvedConflicts.length > 0 ? 'text-amber-600 dark:text-amber-400 animate-pulse' : 'text-slate-400 dark:text-slate-500'}`}
            />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`font-mono text-2xl font-bold ${
                unresolvedConflicts.length > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {unresolvedConflicts.length}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {unresolvedConflicts.length > 0 ? '处需要处理' : '全部已同步'}
            </span>
          </div>
        </div>
      </div>

      {/* Prominent Conflict Interception Banner if any */}
      {unresolvedConflicts.length > 0 && (
        <div className="bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-amber-500/15 dark:from-amber-950/90 dark:via-slate-900 dark:to-amber-950/90 border border-amber-300 dark:border-amber-600/80 rounded-xl p-4 flex items-center justify-between shadow-glow-amber">
          <div className="flex items-center gap-3.5">
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-950 dark:text-amber-200 flex items-center gap-2">
                <span>发现 {unresolvedConflicts.length} 处双向修改冲突</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                  安全拦截中
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                本地与 WebDAV 同时产生修改。为防止数据被覆盖，请前往冲突中心查看差异并选择处理方式。
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onNavigate('conflicts')}
            className="shrink-0 bg-amber-600 hover:bg-amber-500 border-amber-500 gap-1.5"
          >
            <span>处理冲突</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Project Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>同步项目</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">({roots.length})</span>
          </h2>
          <Button variant="secondary" size="sm" onClick={onOpenWizard}>
            + 添加项目
          </Button>
        </div>

        {roots.length === 0 ? (
          <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-8 text-center space-y-3 shadow-soft-sm">
            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center mx-auto text-slate-400 dark:text-slate-500">
              <FolderGit2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">暂无同步项目</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                将本地工作区关联到 WebDAV 目录，并按需配置文件过滤规则，即可开始双向增量同步。
              </p>
            </div>
            <Button variant="primary" size="md" onClick={onOpenWizard}>
              添加同步项目
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
      <ActiveTransferQueue tasks={tasks} onRetryTask={onRetryTask} />
    </div>
  );
}
