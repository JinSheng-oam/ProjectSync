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
    <aside className="w-60 bg-aerospace-rail border-r border-aerospace-border flex flex-col justify-between select-none shrink-0 z-20 shadow-soft-sm">
      <div>
        {/* Brand Header */}
        <div className="px-5 py-4 border-b border-aerospace-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white shadow-soft-sm font-mono font-bold text-sm tracking-wider">
              PS
            </div>
            <div>
              <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                ProjectSync
                <span className="text-[10px] font-mono px-1 py-0.2 bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800 rounded">
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
        <div className="p-3">
          <button
            type="button"
            onClick={onOpenWizard}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-cyan-50 dark:bg-cyan-600/20 hover:bg-cyan-100 dark:hover:bg-cyan-600/30 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/40 text-xs font-semibold shadow-soft-sm transition-all group"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 text-cyan-600 dark:text-cyan-400" />
            添加同步项目
          </button>
        </div>

        {/* Navigation List */}
        <nav className="px-2 space-y-1 mt-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentNav === item.id || (item.id === 'projects' && currentNav === 'project_detail');

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-cyan-50 dark:bg-aerospace-elevated text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/40 font-semibold shadow-soft-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-400'}`} />
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
      <div className="p-3 border-t border-aerospace-border bg-slate-50/50 dark:bg-aerospace-canvas/40 text-[11px] space-y-2">
        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
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
