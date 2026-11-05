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

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch {
      // browser mock mode
    }
  };

  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().toggleMaximize();
    } catch {
      // browser mock mode
    }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().hide();
    } catch {
      // browser mock mode
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
              就绪 · BLAKE3 校验已开启
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

      {/* Global Controls & Desktop Window Mock */}
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

        {/* Simulate Offline button */}
        <button
          type="button"
          onClick={() => setIsOnline(!isOnline)}
          title={isOnline ? '模拟离线状态' : '恢复在线连接'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-soft-sm ${
            isOnline
              ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              : 'bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800'
          }`}
        >
          {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />}
          <span>{isOnline ? '在线' : '离线'}</span>
        </button>

        <Button
          variant="secondary"
          size="sm"
          onClick={togglePause}
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

        {/* Desktop Window Titlebar Controls */}
        <div className="flex items-center ml-1 border-l border-slate-200 dark:border-slate-800 pl-2 text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={handleMinimize}
            title="最小化到托盘"
            className="p-1.5 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            title="窗口最大化"
            className="p-1.5 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            title="关闭窗口 (隐藏到系统托盘常驻)"
            className="p-1.5 hover:text-white hover:bg-rose-600 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
