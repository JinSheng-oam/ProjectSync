import {
  LayoutDashboard,
  FolderGit2,
  Server,
  AlertTriangle,
  History,
  Settings,
  Plus,
  ShieldCheck,
  Cpu,
} from 'lucide-react';
import { ActiveNav } from '../../stores/syncStore';
import { SyncRootDto, ConflictItemDto, WebDavAccountDto } from '../../types/dto';

interface CommandRailProps {
  currentNav: ActiveNav;
  onNavigate: (nav: ActiveNav) => void;
  roots: SyncRootDto[];
  conflicts: ConflictItemDto[];
  accounts: WebDavAccountDto[];
  onOpenWizard: () => void;
}

export function CommandRail({
  currentNav,
  onNavigate,
  roots,
  conflicts,
  accounts,
  onOpenWizard,
}: CommandRailProps) {
  const unresolvedConflictsCount = conflicts.filter((c) => c.status === 'UNRESOLVED').length;

  const navItems = [
    {
      id: 'overview' as ActiveNav,
      label: '总览看板',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'projects' as ActiveNav,
      label: '项目管理',
      icon: FolderGit2,
      badge: roots.length > 0 ? roots.length : null,
      badgeColor: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
    },
    {
      id: 'webdav' as ActiveNav,
      label: 'WebDAV 节点',
      icon: Server,
      badge: accounts.length > 0 ? accounts.length : null,
      badgeColor: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
    },
    {
      id: 'conflicts' as ActiveNav,
      label: '冲突中心',
      icon: AlertTriangle,
      badge: unresolvedConflictsCount > 0 ? unresolvedConflictsCount : null,
      badgeColor: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/50 animate-pulse',
    },
    {
      id: 'history' as ActiveNav,
      label: '同步日志',
      icon: History,
      badge: null,
    },
    {
      id: 'settings' as ActiveNav,
      label: '常规设置',
      icon: Settings,
      badge: null,
    },
  ];

  return (
    <aside className="app-sidebar w-[280px] bg-aerospace-rail/80 border-r border-aerospace-border flex flex-col justify-between select-none shrink-0 z-20 shadow-soft-sm">
      <div>
        {/* Brand Header */}
        <div className="px-6 py-6 border-b border-aerospace-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-12 h-12 rounded-2xl bg-telemetry-indigo flex items-center justify-center text-white shadow-soft-sm font-mono font-bold text-lg tracking-wider">
              PS
            </div>
            <div>
              <div className="font-semibold text-base text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                ProjectSync
                <span className="text-[10px] font-mono px-1 py-0.2 bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded">
                  v1.0
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                双向增量同步
              </div>
            </div>
          </div>
        </div>

        {/* Quick Add Project Action */}
        <div className="p-4">
          <button
            type="button"
            onClick={onOpenWizard}
            className="w-full flex items-center justify-center gap-2 py-3 px-3 rounded-xl bg-telemetry-coral hover:bg-[#ed6d5d] text-white text-sm font-semibold shadow-soft-coral transition-colors group"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
            添加同步项目
          </button>
        </div>

        {/* Navigation List */}
        <nav className="px-3 space-y-1.5 mt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentNav === item.id || (item.id === 'projects' && currentNav === 'project_detail');

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-100/80 dark:bg-indigo-500/15 text-indigo-900 dark:text-indigo-200 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                      item.badgeColor || 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer System Telemetry */}
      <div className="p-4 border-t border-aerospace-border bg-white/25 dark:bg-aerospace-canvas/30 text-xs space-y-3">
        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            设备标识
          </span>
          <code className="font-mono text-[10px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-900 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800">
            Win11-Office-PC
          </code>
        </div>
        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            冲突策略
          </span>
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            保留双端版本
          </span>
        </div>
      </div>
    </aside>
  );
}
