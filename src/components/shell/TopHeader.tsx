import {
  RefreshCw,
  Pause,
  Play,
  Wifi,
  WifiOff,
  Bell,
  Sun,
  Moon,
  Sparkles,
} from 'lucide-react';
import { Button } from '../common/UIComponents';
import { SyncRootDto, WebDavAccountDto } from '../../types/dto';
import { AiMergeSession } from '../../stores/syncStore';

interface TopHeaderProps {
  title: string;
  roots: SyncRootDto[];
  accounts: WebDavAccountDto[];
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSyncAll: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  bannerAlert: string | null;
  aiSession?: AiMergeSession | null;
  onOpenAiMerge?: () => void;
}

export function TopHeader({
  title,
  roots,
  accounts,
  theme,
  onToggleTheme,
  onSyncAll,
  onPauseAll,
  onResumeAll,
  bannerAlert,
  aiSession,
  onOpenAiMerge,
}: TopHeaderProps) {
  const enabledRoots = roots.filter((root) => root.enabled && root.status !== 'DISABLED');
  const allPaused = enabledRoots.length > 0 && enabledRoots.every((root) => root.status === 'PAUSED');
  const onlineCount = accounts.filter((account) => account.status === 'ONLINE').length;
  const statusLabel = accounts.length === 0 || (onlineCount === 0 && accounts.some((account) => account.status === 'UNTESTED'))
    ? '未检测'
    : onlineCount === accounts.length ? '在线' : onlineCount > 0 ? '部分在线' : '离线';
  const isSyncingAny = roots.some((r) => r.status === 'SYNCING');

  const togglePause = () => {
    if (allPaused) {
      onResumeAll();
    } else {
      onPauseAll();
    }
  };

  return (
    <header className="h-16 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 px-6 select-none shrink-0 z-10 transition-colors">
      {/* Title & Telemetry Beacon */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">{title}</h1>
        <div className="hidden md:flex items-center gap-2 text-xs border-l border-slate-200 dark:border-slate-800 pl-3">
          {isSyncingAny ? (
            <span className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
              正在同步文件...
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              就绪
            </span>
          )}
        </div>
      </div>

      {/* Center Toast / Alert if any */}
      {bannerAlert && (
        <div className="text-xs px-3 py-1 bg-indigo-50 dark:bg-indigo-950/90 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg shadow-sm animate-in fade-in flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          <span>{bannerAlert}</span>
        </div>
      )}

      {/* Persistent Background AI Merge Indicator */}
      {aiSession && (aiSession.status === 'merging' || aiSession.status === 'ready') && (
        <button
          type="button"
          onClick={onOpenAiMerge}
          className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border shadow-soft-sm transition-all cursor-pointer ${
            aiSession.status === 'merging'
              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700 animate-pulse'
              : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
          }`}
          title="点击打开 AI 合并交互与审阅面板"
        >
          <Sparkles className={`w-3.5 h-3.5 ${aiSession.status === 'merging' ? 'animate-spin text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`} />
          <span>
            {aiSession.status === 'merging' ? 'AI 正在后台合并: ' : 'AI 合并已就绪: '}
            <strong className="font-mono">{aiSession.relativePath}</strong>
          </span>
          <span className="text-[11px] underline opacity-80">点击查看</span>
        </button>
      )}

      {/* Global Controls */}
      <div className="flex items-center justify-end gap-2 shrink-0">
        {/* Light / Dark Mode Toggle Button */}
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? '切换至浅色模式' : '切换至暗色模式'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-soft-sm"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">浅色</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">暗色</span>
            </>
          )}
        </button>

        <span title="WebDAV 节点最近一次连接状态" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300">
          {onlineCount > 0 ? <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-slate-500" />}
          {statusLabel}
        </span>

        <Button
          variant="secondary"
          size="sm"
          onClick={togglePause}
          disabled={enabledRoots.length === 0}
          className="gap-1.5"
        >
          {allPaused ? <Play className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />}
          <span>{allPaused ? '恢复全部' : '全部暂停'}</span>
        </Button>

        <Button
          variant="primary"
          size="sm"
          onClick={onSyncAll}
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAny ? 'animate-spin' : ''}`} />
          <span>全部同步</span>
        </Button>
      </div>
    </header>
  );
}
