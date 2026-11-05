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
    <div className="space-y-7 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 xl:grid-cols-4 overflow-hidden bg-white/55 dark:bg-aerospace-surface/60 backdrop-blur-xl border border-white/70 dark:border-aerospace-border/80 rounded-2xl shadow-soft-sm">
        <div className="p-6 border-b xl:border-b-0 border-r border-aerospace-border/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>同步项目</span>
            <FolderGit2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-100">{roots.length}</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">个目录</span>
          </div>
        </div>

        <div className="p-6 border-b xl:border-b-0 xl:border-r border-aerospace-border/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>WebDAV 节点</span>
            <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-100">{onlineAccounts.length}</span>
            <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium font-mono">/{accounts.length} 在线</span>
          </div>
        </div>

        <div className="p-6 border-r border-aerospace-border/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>正在传输</span>
            <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-indigo-600 dark:text-indigo-400">{activeTasks.length}</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">个文件</span>
          </div>
        </div>

        <div
          onClick={() => onNavigate('conflicts')}
          className={`p-6 cursor-pointer transition-colors ${
            unresolvedConflicts.length > 0
              ? 'bg-amber-50/80 dark:bg-amber-950/40 hover:bg-amber-100/80 dark:hover:bg-amber-950/60'
              : 'hover:bg-aerospace-elevated'
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
        <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-2xl p-4 flex items-center justify-between shadow-soft-sm">
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
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>同步项目</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">({roots.length})</span>
          </h2>
          <Button variant="coral" size="md" onClick={onOpenWizard}>
            + 添加项目
          </Button>
        </div>

        {roots.length === 0 ? (
          <div className="min-h-[370px] bg-white/50 dark:bg-aerospace-surface/60 backdrop-blur-xl border border-white/70 dark:border-aerospace-border rounded-2xl px-10 py-8 text-center flex flex-col items-center justify-center shadow-soft-sm">
            <img src={emptySyncIllustration} alt="" className="w-56 h-36 object-contain mb-3" />
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">暂无同步项目</h3>
              <p className="text-base text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-7">
                将本地工作区关联到 WebDAV 目录，并按需配置文件过滤规则，即可开始双向增量同步。
              </p>
            </div>
            <Button variant="coral" size="lg" onClick={onOpenWizard} className="mt-4 px-7 shadow-soft-coral">
              <span className="text-lg leading-none">+</span> 添加同步项目
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
