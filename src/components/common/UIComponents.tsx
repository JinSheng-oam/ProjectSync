import React, { useState } from 'react';
import { Copy, Check, AlertTriangle, CheckCircle2, PauseCircle, RefreshCw, XCircle } from 'lucide-react';
import { SyncRootStatus } from '../../types/dto';

export function StatusBadge({ status, pulse = false }: { status: SyncRootStatus | 'ONLINE' | 'OFFLINE'; pulse?: boolean }) {
  switch (status) {
    case 'SYNCING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium bg-cyan-50 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/60 shadow-soft-sm">
          <RefreshCw className={`w-3 h-3 ${pulse ? 'animate-spin' : ''}`} />
          同步中
        </span>
      );
    case 'CONFLICT':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-400 border border-amber-300 dark:border-amber-700/70 shadow-glow-amber">
          <AlertTriangle className="w-3 h-3 animate-pulse text-amber-600 dark:text-amber-400" />
          存在冲突
        </span>
      );
    case 'PAUSED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
          <PauseCircle className="w-3 h-3 text-slate-500 dark:text-slate-400" />
          已暂停
        </span>
      );
    case 'ERROR':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
          <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
          同步异常
        </span>
      );
    case 'DISABLED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
          <PauseCircle className="w-3 h-3" />
          已停用
        </span>
      );
    case 'ONLINE':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
          在线
        </span>
      );
    case 'OFFLINE':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-500 border border-slate-300 dark:border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
          离线
        </span>
      );
    case 'IDLE':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          已同步
        </span>
      );
  }
}

export function PathDisplay({ path, label }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 group/path max-w-full">
      {label && <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 font-medium">{label}:</span>}
      <code
        title={path}
        className="font-mono text-xs text-slate-800 dark:text-slate-300 bg-slate-100 dark:bg-aerospace-canvas px-2 py-0.5 rounded border border-slate-200 dark:border-aerospace-border truncate select-all hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
      >
        {path}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        title="复制路径"
        className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 shrink-0 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  onClick,
  type = 'button',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
}) {
  const baseClasses =
    'inline-flex items-center justify-center font-medium transition-all rounded select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed';

  const sizeClasses = {
    sm: 'text-xs px-2.5 py-1 gap-1.5',
    md: 'text-xs px-3.5 py-1.5 gap-2',
    lg: 'text-sm px-4 py-2 gap-2',
  }[size];

  const variantClasses = {
    primary:
      'bg-cyan-600 hover:bg-cyan-500 text-white shadow-soft-sm hover:shadow-glow-cyan active:bg-cyan-700 font-semibold',
    secondary:
      'bg-aerospace-elevated hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-aerospace-border hover:border-slate-400 dark:hover:border-slate-500 active:bg-slate-300 dark:active:bg-slate-800 shadow-soft-sm',
    danger:
      'bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-900/60 dark:hover:bg-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-700 active:bg-rose-300 dark:active:bg-rose-950',
    ghost:
      'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white',
    accent:
      'bg-emerald-600 hover:bg-emerald-500 text-white shadow-soft-sm active:bg-emerald-700 font-semibold',
  }[variant];

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
    >
      {children}
    </button>
  );
}

export function Modal({
  isOpen,
  title,
  subtitle,
  children,
  onClose,
  maxWidth = 'max-w-2xl',
}: {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={`bg-aerospace-surface border border-aerospace-borderLight rounded-xl shadow-soft-lg w-full ${maxWidth} flex flex-col max-h-[90vh] overflow-hidden`}
        role="dialog"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-aerospace-border bg-aerospace-rail/60">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4 text-slate-800 dark:text-slate-200 text-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
