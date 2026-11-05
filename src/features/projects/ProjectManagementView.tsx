import { useMemo, useState } from 'react';
import {
  Cloud,
  Folder,
  HardDrive,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import { Button, StatusBadge } from '../../components/common/UIComponents';
import { SyncRootDto } from '../../types/dto';
import emptySyncIllustration from '../../assets/empty-sync-indigo.png';

type ProjectFilter = 'all' | 'active' | 'paused' | 'attention';

interface ProjectManagementViewProps {
  roots: SyncRootDto[];
  onOpenDetail: (rootId: string) => void;
  onOpenWizard: () => void;
  onSyncNow: (rootId: string) => void;
  onPause: (rootId: string) => void;
  onResume: (rootId: string) => void;
  onEnable: (rootId: string) => void;
}

const FILTERS: { id: ProjectFilter; label: string }[] = [
  { id: 'all', label: '全部项目' },
  { id: 'active', label: '正常运行' },
  { id: 'paused', label: '已暂停' },
  { id: 'attention', label: '需处理' },
];

function matchesFilter(root: SyncRootDto, filter: ProjectFilter) {
  switch (filter) {
    case 'active':
      return root.status === 'IDLE' || root.status === 'SYNCING';
    case 'paused':
      return root.status === 'PAUSED' || root.status === 'DISABLED' || !root.enabled;
    case 'attention':
      return root.status === 'CONFLICT' || root.status === 'ERROR';
    default:
      return true;
  }
}

function getLastSyncLabel(timestamp?: number) {
  if (!timestamp) return '尚未同步';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ProjectManagementView({
  roots,
  onOpenDetail,
  onOpenWizard,
  onSyncNow,
  onPause,
  onResume,
  onEnable,
}: ProjectManagementViewProps) {
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => ({
    all: roots.length,
    active: roots.filter((root) => matchesFilter(root, 'active')).length,
    paused: roots.filter((root) => matchesFilter(root, 'paused')).length,
    attention: roots.filter((root) => matchesFilter(root, 'attention')).length,
  }), [roots]);

  const filteredRoots = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return roots.filter((root) => {
      const matchesSearch = !normalizedQuery || [root.name, root.remoteProjectId, root.localPath, root.remotePath]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      return matchesSearch && matchesFilter(root, filter);
    });
  }, [filter, query, roots]);

  return (
    <div className="max-w-7xl mx-auto space-y-7">
      <section className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">项目空间</p>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">项目目录</h2>
          <p className="text-base text-slate-500 dark:text-slate-400">
            管理本地目录与 WebDAV 远端路径的同步绑定。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full xl:w-auto">
          <label className="flex items-center gap-2.5 min-w-0 xl:w-80 px-4 py-3 rounded-xl bg-white/65 dark:bg-aerospace-surface/70 border border-white/70 dark:border-aerospace-border shadow-soft-sm focus-within:border-indigo-300 dark:focus-within:border-indigo-600 transition-colors">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目、路径或 ID"
              className="w-full min-w-0 bg-transparent outline-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              aria-label="搜索项目、路径或 ID"
            />
          </label>
          <Button variant="coral" size="lg" onClick={onOpenWizard} className="shrink-0 shadow-soft-coral">
            <Plus className="w-4 h-4" />
            添加同步项目
          </Button>
        </div>
      </section>

      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="项目状态筛选">
          {FILTERS.map((item) => {
            const isActive = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setFilter(item.id)}
                className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-100/90 dark:bg-indigo-500/20 text-indigo-900 dark:text-indigo-200 border border-indigo-200/80 dark:border-indigo-700/60'
                    : 'bg-white/35 dark:bg-aerospace-surface/35 text-slate-600 dark:text-slate-300 border border-transparent hover:bg-white/70 dark:hover:bg-aerospace-surface/70'
                }`}
              >
                {item.label}
                <span className="font-mono text-xs opacity-70">{counts[item.id]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Folder className="w-4 h-4 text-indigo-500" />
          显示 {filteredRoots.length} / {roots.length} 个项目
        </div>
      </section>

      {roots.length === 0 ? (
        <section className="min-h-[440px] bg-white/50 dark:bg-aerospace-surface/60 backdrop-blur-xl border border-white/70 dark:border-aerospace-border rounded-2xl px-10 py-9 text-center flex flex-col items-center justify-center shadow-soft-sm">
          <img src={emptySyncIllustration} alt="" className="w-56 h-36 object-contain mb-3" />
          <h3 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">还没有同步项目</h3>
          <p className="mt-2 text-base text-slate-500 dark:text-slate-400 max-w-xl leading-7">
            添加项目后，可以在这里集中查看目录绑定、同步状态和最近活动。
          </p>
          <Button variant="coral" size="lg" onClick={onOpenWizard} className="mt-6 px-7 shadow-soft-coral">
            <Plus className="w-4 h-4" />
            添加同步项目
          </Button>
        </section>
      ) : filteredRoots.length === 0 ? (
        <section className="min-h-[320px] bg-white/50 dark:bg-aerospace-surface/60 backdrop-blur-xl border border-white/70 dark:border-aerospace-border rounded-2xl p-10 text-center flex flex-col items-center justify-center shadow-soft-sm">
          <Search className="w-8 h-8 text-indigo-300 dark:text-indigo-700" />
          <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">没有匹配的项目</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">换个关键词或状态筛选试试。</p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-white/55 dark:bg-aerospace-surface/65 backdrop-blur-xl border border-white/70 dark:border-aerospace-border shadow-soft-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-aerospace-border/80">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">同步绑定</h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">每一行对应一个本地目录与远端目录。</p>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <HardDrive className="w-4 h-4" /> 本地目录
              <span className="mx-1 text-indigo-400">↔</span>
              <Cloud className="w-4 h-4 text-indigo-500" /> WebDAV
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left">
              <thead className="bg-white/35 dark:bg-aerospace-canvas/25">
                <tr className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="px-6 py-3.5 font-medium">项目</th>
                  <th className="px-5 py-3.5 font-medium">本地目录</th>
                  <th className="px-5 py-3.5 font-medium">WebDAV 远端路径</th>
                  <th className="px-5 py-3.5 font-medium">状态</th>
                  <th className="px-5 py-3.5 font-medium">最近同步</th>
                  <th className="px-5 py-3.5 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoots.map((root) => {
                  const isDisabled = root.status === 'DISABLED' || !root.enabled;
                  const isPaused = root.status === 'PAUSED';
                  const isSyncing = root.status === 'SYNCING';

                  return (
                    <tr key={root.id} className="border-t border-aerospace-border/70 hover:bg-white/45 dark:hover:bg-aerospace-elevated/35 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3 min-w-[210px]">
                          <span className="w-10 h-10 rounded-xl bg-indigo-100/80 dark:bg-indigo-500/15 flex items-center justify-center shrink-0">
                            <Folder className="w-5 h-5 text-indigo-600 dark:text-indigo-300" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={root.name}>{root.name}</span>
                            <span className="block mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400" title={root.remoteProjectId}>{root.remoteProjectId}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 max-w-[260px]">
                        <span className="block truncate font-mono text-xs text-slate-700 dark:text-slate-300" title={root.localPath}>{root.localPath}</span>
                      </td>
                      <td className="px-5 py-4 max-w-[230px]">
                        <span className="block truncate font-mono text-xs text-slate-700 dark:text-slate-300" title={root.remotePath}>{root.remotePath}</span>
                      </td>
                      <td className="px-5 py-4"><StatusBadge status={root.status} pulse={isSyncing} /></td>
                      <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{getLastSyncLabel(root.lastSyncAt)}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenDetail(root.id)}
                            className="gap-1.5"
                          >
                            <Settings2 className="w-3.5 h-3.5" /> 配置
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => isDisabled ? onEnable(root.id) : isPaused ? onResume(root.id) : onPause(root.id)}
                            className="gap-1.5"
                          >
                            {isDisabled ? <Play className="w-3.5 h-3.5 text-emerald-600" /> : isPaused ? <Play className="w-3.5 h-3.5 text-emerald-600" /> : <Pause className="w-3.5 h-3.5 text-amber-600" />}
                            {isDisabled ? '启用' : isPaused ? '恢复' : '暂停'}
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={isSyncing || isDisabled}
                            onClick={() => onSyncNow(root.id)}
                            className="gap-1.5"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} /> 同步
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
