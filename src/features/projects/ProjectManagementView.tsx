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
import { Button, StatusBadge, formatDisplayPath } from '../../components/common/UIComponents';
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

function matchesFilter(root: SyncRootDto, filter: ProjectFilter): boolean {
  const isDisabled = root.status === 'DISABLED' || !root.enabled;
  const isPaused = root.status === 'PAUSED';
  const hasError = root.status === 'ERROR' || root.status === 'CONFLICT';

  switch (filter) {
    case 'active':
      return !isDisabled && !isPaused && !hasError;
    case 'paused':
      return isPaused || isDisabled;
    case 'attention':
      return hasError;
    case 'all':
    default:
      return true;
  }
}

function getLastSyncLabel(timestamp?: number): string {
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner Header Card (Consistent with other views) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-soft-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <Folder className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>项目目录管理</span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-medium">
                双向同步绑定
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              管理本地工程目录与 WebDAV 远端存储的增量同步绑定及运行状态。
            </p>
          </div>
        </div>

        <Button variant="primary" size="md" onClick={onOpenWizard} className="gap-1.5 shrink-0">
          <Plus className="w-4 h-4" />
          <span>添加同步项目</span>
        </Button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="项目状态筛选">
          {FILTERS.map((item) => {
            const isActive = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setFilter(item.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-semibold shadow-soft-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span>{item.label}</span>
                <span className="font-mono text-xs opacity-80 tabular-nums">{counts[item.id]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 min-w-0 w-full sm:w-64 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft-sm focus-within:border-indigo-500 transition-colors">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目名称或路径..."
              className="w-full min-w-0 bg-transparent outline-none text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              aria-label="搜索项目名称或路径"
            />
          </label>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
            共 {filteredRoots.length} 个项目
          </div>
        </div>
      </div>

      {/* Card Grid */}
      {roots.length === 0 ? (
        <section className="min-h-[300px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center flex flex-col items-center justify-center shadow-soft-sm transition-colors">
          <img src={emptySyncIllustration} alt="" className="w-48 h-28 object-contain mb-3" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">还没有同步项目</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">添加项目后即可实时管理本地与远端同步。</p>
          <Button variant="primary" size="sm" onClick={onOpenWizard} className="mt-4 gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            <span>立即添加</span>
          </Button>
        </section>
      ) : filteredRoots.length === 0 ? (
        <section className="min-h-[200px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center flex flex-col items-center justify-center shadow-soft-sm transition-colors">
          <Search className="w-6 h-6 text-slate-400 mb-2" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">未检索到项目</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">请尝试调整搜索词或状态筛选条件。</p>
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRoots.map((root) => {
            const isDisabled = root.status === 'DISABLED' || !root.enabled;
            const isPaused = root.status === 'PAUSED';
            const isSyncing = root.status === 'SYNCING';

            return (
              <div
                key={root.id}
                className="project-card rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft-sm p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div>
                  {/* Card Header: Icon + Title/ID + StatusBadge (No wrapping) */}
                  <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-10 h-10 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/60 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400">
                        <Folder className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={root.name}>
                          {root.name}
                        </h3>
                        <p className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate" title={root.remoteProjectId}>
                          {root.remoteProjectId}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 pt-0.5">
                      <StatusBadge status={root.status} pulse={isSyncing} />
                    </div>
                  </div>

                  {/* Path Routing Box (Normalized, no raw \\?\ prefix) */}
                  <div className="mt-3.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-slate-400 dark:text-slate-500 shrink-0 flex items-center gap-1 font-mono text-xs w-12">
                        <HardDrive className="w-3.5 h-3.5" />
                        <span>本地</span>
                      </span>
                      <span
                        className="font-mono text-xs truncate text-slate-800 dark:text-slate-200 select-all hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        title={formatDisplayPath(root.localPath)}
                      >
                        {formatDisplayPath(root.localPath)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-indigo-600/80 dark:text-indigo-400/80 shrink-0 flex items-center gap-1 font-mono text-xs w-12">
                        <Cloud className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                        <span>远端</span>
                      </span>
                      <span
                        className="font-mono text-xs truncate text-indigo-700 dark:text-indigo-300 font-medium select-all hover:underline cursor-pointer"
                        title={root.remotePath}
                      >
                        {root.remotePath}
                      </span>
                    </div>
                  </div>

                  {/* Recent Sync Metadata */}
                  <div className="mt-3.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono">
                    <span className="text-slate-400 dark:text-slate-500">最近同步</span>
                    <span className="text-slate-700 dark:text-slate-300 font-medium">{getLastSyncLabel(root.lastSyncAt)}</span>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenDetail(root.id)}
                    className="h-8 px-2.5 text-xs gap-1.5 text-slate-700 dark:text-slate-300"
                  >
                    <Settings2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>配置</span>
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => isDisabled ? onEnable(root.id) : isPaused ? onResume(root.id) : onPause(root.id)}
                      className="h-8 px-2.5 text-xs gap-1.5"
                    >
                      {isDisabled || isPaused ? (
                        <Play className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Pause className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      )}
                      <span>{isDisabled ? '启用' : isPaused ? '恢复' : '暂停'}</span>
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isSyncing || isDisabled}
                      onClick={() => onSyncNow(root.id)}
                      className="h-8 px-3 text-xs gap-1.5 shadow-soft-sm font-medium"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>同步</span>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
