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
  Sparkles,
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
      badgeColor: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
    },
    {
      id: 'webdav' as ActiveNav,
      label: 'WebDAV 节点',
      icon: Server,
      badge: accounts.length > 0 ? accounts.length : null,
      badgeColor: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
    },
    {
      id: 'conflicts' as ActiveNav,
      label: '冲突中心',
      icon: AlertTriangle,
      badge: unresolvedConflictsCount > 0 ? unresolvedConflictsCount : null,
      badgeColor: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700',
    },
    {
      id: 'history' as ActiveNav,
      label: '同步日志',
      icon: History,
      badge: null,
    },
    {
      id: 'ai' as ActiveNav,
      label: 'AI 设置',
      icon: Sparkles,
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
    <aside className="app-sidebar w-[260px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between select-none shrink-0 z-20 transition-colors">
      <div>
        {/* Brand Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/projectsync-icon-v2.png"
              alt=""
              width={36}
              height={36}
              className="w-9 h-9 object-contain shrink-0 rounded-lg"
            />
            <div>
              <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                ProjectSync
                <span className="text-[11px] font-mono px-1.5 py-0.2 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded">
                  v1.0
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Add Project Action */}
        <div className="p-3">
          <button
            type="button"
            onClick={onOpenWizard}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium shadow-soft-sm hover:shadow-glow-indigo active:bg-indigo-800 transition-all group"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
            添加同步项目
          </button>
        </div>

        {/* Navigation List */}
        <nav className="px-2.5 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentNav === item.id || (item.id === 'projects' && currentNav === 'project_detail');

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-100 dark:border-indigo-800/60'
                    : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span
                    className={`font-mono text-[11px] px-1.5 py-0.5 rounded-md font-semibold ${
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
      <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 text-xs space-y-2.5">
        <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            设备标识
          </span>
          <code className="font-mono text-[11px] text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
            Win11-Office-PC
          </code>
        </div>
        <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            冲突策略
          </span>
          <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
            保留双端版本
          </span>
        </div>
      </div>
    </aside>
  );
}
