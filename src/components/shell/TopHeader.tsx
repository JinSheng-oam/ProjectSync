import { useState } from 'react';
import {
  RefreshCw,
  Pause,
  Play,
  Wifi,
  WifiOff,
  Minus,
  Square,
  X,
  Bell,
  Sun,
  Moon,
} from 'lucide-react';
import { Button } from '../common/UIComponents';
import { SyncRootDto } from '../../types/dto';

interface TopHeaderProps {
  title: string;
  roots: SyncRootDto[];
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSyncAll: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  bannerAlert: string | null;
}

export function TopHeader({
  title,
  roots,
  theme,
  onToggleTheme,
  onSyncAll,
  onPauseAll,
  onResumeAll,
  bannerAlert,
}: TopHeaderProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [allPaused, setAllPaused] = useState(false);
  const isSyncingAny = roots.some((r) => r.status === 'SYNCING');

  const togglePause = () => {
    if (allPaused) {
      onResumeAll();
      setAllPaused(false);
    } else {
      onPauseAll();
      setAllPaused(true);
    }
  };

  return (
    <header className="h-12 bg-aerospace-rail/90 backdrop-blur border-b border-aerospace-border flex items-center justify-between px-4 select-none shrink-0 z-10">
      {/* Title & Telemetry Beacon */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        <div className="h-4 w-[1px] bg-aerospace-border" />
        <div className="flex items-center gap-2">
          {isSyncingAny ? (
            <span className="flex items-center gap-1.5 text-xs text-cyan-600 dark:text-cyan-400 font-medium">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-500" />
              正在同步文件...
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              就绪 · BLAKE3 哈希校验已开启
            </span>
          )}
        </div>
      </div>

      {/* Center Toast / Alert if any */}
      {bannerAlert && (
        <div className="text-xs px-3 py-1 bg-cyan-50 dark:bg-cyan-950/90 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700/60 rounded-md shadow-sm animate-in fade-in flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-cyan-500" />
          <span>{bannerAlert}</span>
        </div>
      )}

      {/* Global Controls & Desktop Window Mock */}
      <div className="flex items-center gap-2.5">
        {/* Light / Dark Mode Toggle Button */}
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? '切换至浅色模式' : '切换至暗色模式'}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border border-aerospace-border bg-aerospace-elevated text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 transition-colors"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">浅色</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-cyan-600" />
              <span className="hidden sm:inline">暗色</span>
            </>
          )}
        </button>

        {/* Simulate Offline button */}
        <button
          type="button"
          onClick={() => setIsOnline(!isOnline)}
          title={isOnline ? '模拟离线状态' : '恢复在线连接'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            isOnline
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
              : 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 animate-pulse'
          }`}
        >
          {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />}
          {isOnline ? '在线' : '离线'}
        </button>

        <Button
          variant="secondary"
          size="sm"
          onClick={togglePause}
          className="gap-1.5"
        >
          {allPaused ? <Play className="w-3.5 h-3.5 text-emerald-500" /> : <Pause className="w-3.5 h-3.5 text-amber-500" />}
          {allPaused ? '恢复全部' : '全部暂停'}
        </Button>

        <Button
          variant="primary"
          size="sm"
          onClick={onSyncAll}
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAny ? 'animate-spin' : ''}`} />
          全部同步
        </Button>

        {/* Desktop Window Titlebar Controls */}
        <div className="flex items-center ml-1 border-l border-aerospace-border pl-2 text-slate-400 dark:text-slate-500">
          <button
            type="button"
            title="最小化到托盘"
            className="p-1.5 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="窗口最大化"
            className="p-1.5 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="关闭窗口 (隐藏到系统托盘常驻)"
            className="p-1.5 hover:text-white hover:bg-rose-600 dark:hover:bg-rose-900 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
