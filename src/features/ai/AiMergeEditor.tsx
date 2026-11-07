import { Copy, Check, RotateCcw, HardDrive, Cloud, FileCheck2, LoaderCircle } from 'lucide-react';


interface AiMergeEditorProps {
  aiSourceView: 'merged' | 'local' | 'remote';
  setAiSourceView: (view: 'merged' | 'local' | 'remote') => void;
  isModified: boolean;
  lineCount: number;
  charCount: number;
  handleResetToPreview: () => void;
  handleCopyCode: () => void;
  copiedCode: boolean;
  localDraftContent: string;
  setLocalDraftContent: (content: string) => void;
  isBusyMerging: boolean;
  isBusyApplying: boolean;
  currentViewContent: string;
}

export function AiMergeEditor({
  aiSourceView,
  setAiSourceView,
  isModified,
  lineCount,
  charCount,
  handleResetToPreview,
  handleCopyCode,
  copiedCode,
  localDraftContent,
  setLocalDraftContent,
  isBusyMerging,
  isBusyApplying,
  currentViewContent,
}: AiMergeEditorProps) {
  return (
  <div className="lg:col-span-7 flex flex-col min-h-0 overflow-hidden bg-slate-50/40 dark:bg-slate-950/40">
    {/* View Switcher & File Stats Header */}
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-2 bg-white dark:bg-slate-900 shrink-0">
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 text-xs">
        <button
          type="button"
          onClick={() => setAiSourceView('merged')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium whitespace-nowrap ${
            aiSourceView === 'merged'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
          <span>合并结果</span>
          {isModified && (
            <span
              title="已手动修改"
              className="w-1.5 h-1.5 rounded-full bg-amber-500"
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => setAiSourceView('local')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium whitespace-nowrap ${
            aiSourceView === 'local'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <HardDrive className="w-3.5 h-3.5 shrink-0" />
          <span>本地版本</span>
        </button>
        <button
          type="button"
          onClick={() => setAiSourceView('remote')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium whitespace-nowrap ${
            aiSourceView === 'remote'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Cloud className="w-3.5 h-3.5 shrink-0" />
          <span>远端版本</span>
        </button>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
            aiSourceView === 'merged'
              ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {aiSourceView === 'merged' ? '可编辑' : '只读'}
        </span>
        <span className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 hidden sm:inline">
          {lineCount} 行 · {charCount.toLocaleString()} 字符
        </span>
        {aiSourceView === 'merged' && isModified && (
          <button
            type="button"
            onClick={handleResetToPreview}
            title="还原为 AI 生成结果"
            className="p-1 rounded-md text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleCopyCode}
          title="复制当前内容"
          className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {copiedCode ? (
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>

    {/* Code / Text Area Viewport */}
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto py-3 px-2 flex font-mono text-xs leading-5">
        {/* Line Numbers Gutter */}
        <div className="select-none pr-3 pl-2 text-right text-slate-400/80 dark:text-slate-600 border-r border-slate-200/80 dark:border-slate-800 shrink-0 font-mono text-[11px] tabular-nums">
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i} className="leading-5 h-5">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Synchronized Editor / Readonly Display */}
        <div className="flex-1 pl-3 pr-2 min-w-0">
          {aiSourceView === 'merged' ? (
            <textarea
              value={localDraftContent}
              onChange={(e) => setLocalDraftContent(e.target.value)}
              disabled={isBusyMerging || isBusyApplying}
              style={{ height: `${Math.max(lineCount * 20, 360)}px` }}
              className="w-full bg-transparent resize-none border-none outline-none overflow-hidden font-mono text-xs text-slate-800 dark:text-slate-200 leading-5 focus:ring-0 p-0 selection:bg-indigo-500/20"
              placeholder="// 合并结果将显示在此处，支持直接编辑微调..."
              spellCheck={false}
            />
          ) : (
            <pre className="w-full whitespace-pre font-mono text-xs text-slate-700 dark:text-slate-300 leading-5 p-0 select-text m-0">
              {currentViewContent || (
                <span className="text-slate-400 italic">内容为空</span>
              )}
            </pre>
          )}
        </div>
      </div>

      {/* Non-scrolling Loading Overlay on Editor */}
      {isBusyMerging && (
        <div className="absolute inset-0 bg-white/75 dark:bg-slate-900/75 backdrop-blur-[2px] flex items-center justify-center z-10 animate-in fade-in duration-150">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-soft-md">
            <LoaderCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0" />
            <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
              正在生成合并代码…
            </span>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}
