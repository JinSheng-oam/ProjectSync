import {
  Folder,
  Cloud,
  Play,
  Pause,
  RefreshCw,
  ChevronRight,
  HardDrive,
  FileCode,
} from 'lucide-react';
import { SyncRootDto } from '../../types/dto';
import { StatusBadge, PathDisplay, Button } from '../../components/common/UIComponents';

interface ProjectSummaryCardProps {
  root: SyncRootDto;
  onOpenDetail: (rootId: string) => void;
  onSyncNow: (rootId: string) => void;
  onPause: (rootId: string) => void;
  onResume: (rootId: string) => void;
  onEnable: (rootId: string) => void;
}

export function ProjectSummaryCard({
  root,
  onOpenDetail,
  onSyncNow,
  onPause,
  onResume,
  onEnable,
}: ProjectSummaryCardProps) {
  const isSyncing = root.status === 'SYNCING';
  const isPaused = root.status === 'PAUSED';
  const isDisabled = root.status === 'DISABLED' || !root.enabled;

  return (
    <div
      onClick={() => onOpenDetail(root.id)}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-5 shadow-soft-sm transition-all cursor-pointer group hover:shadow-md"
    >
      {/* Top Header of Card */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 group-hover:scale-105 transition-transform shadow-soft-sm">
            <Folder className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-slate-700 dark:group-hover:text-white transition-colors">
                {root.name}
              </h3>
              <code className="text-[11px] font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                {root.remoteProjectId}
              </code>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1">
                <FileCode className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                <span className="font-mono text-slate-800 dark:text-slate-200 font-medium">{root.fileCount || 0}</span> 个文件
              </span>
              <span>•</span>
              <span>轮询间隔 <span className="font-mono text-slate-800 dark:text-slate-200 font-medium">{root.pollIntervalSeconds}s</span></span>
              {root.pendingChanges ? (
                <>
                  <span>•</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">
                    <span className="font-mono">{root.pendingChanges}</span> 项待同步
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <StatusBadge status={root.status} pulse={isSyncing} />
        </div>
      </div>

      {/* Path Display Rows (Flattened, no nested-card slop) */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-2.5 min-w-0 py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <HardDrive className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium mb-0.5">本地路径</span>
            <PathDisplay path={root.localPath} />
          </div>
        </div>

        <div className="flex items-center gap-2.5 min-w-0 py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <Cloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium mb-0.5">远端 WebDAV 路径</span>
            <PathDisplay path={root.remotePath} />
          </div>
        </div>
      </div>

      {/* Card Footer Actions */}
      <div
        className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs text-slate-600 dark:text-slate-400">
          最后同步:{' '}
          <span className="text-slate-900 dark:text-slate-200 font-mono">
            {root.lastSyncAt ? new Date(root.lastSyncAt).toLocaleTimeString() : '尚未同步'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isDisabled ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEnable(root.id)}
              className="gap-1 text-xs"
            >
              <Play className="w-3.5 h-3.5 text-emerald-600" />
              启用
            </Button>
          ) : isPaused ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onResume(root.id)}
              className="gap-1 text-xs"
            >
              <Play className="w-3.5 h-3.5 text-emerald-600" />
              恢复
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onPause(root.id)}
              className="gap-1 text-xs"
            >
              <Pause className="w-3.5 h-3.5 text-amber-600" />
              暂停
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={() => onSyncNow(root.id)}
            disabled={isSyncing}
            className="gap-1 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            立即同步
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenDetail(root.id)}
            className="gap-1 text-slate-700 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-indigo-300"
          >
            <span>配置与文件</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
