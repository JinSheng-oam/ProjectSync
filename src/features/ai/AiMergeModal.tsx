import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Cpu,
  Minimize2,
  X,
  Copy,
  Check,
  RotateCcw,
  HardDrive,
  Cloud,
  FileCheck2,
  User,
  Bot,
  Send,
  LoaderCircle,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { AiMergeSession } from '../../stores/syncStore';

interface AiMergeModalProps {
  session: AiMergeSession | null;
  projectName?: string;
  onRefine: (instruction: string, currentContent?: string) => Promise<void>;
  onApply: (finalContent?: string) => Promise<void>;
  onClose: () => void;
  onCancel: () => void;
  onOpenAiSettings: () => void;
}

export function AiMergeModal({
  session,
  projectName = 'ProjectSync',
  onRefine,
  onApply,
  onClose,
  onCancel,
  onOpenAiSettings,
}: AiMergeModalProps) {
  const [localDraftContent, setLocalDraftContent] = useState('');
  const [aiSourceView, setAiSourceView] = useState<'merged' | 'local' | 'remote'>('merged');
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [agentInstruction, setAgentInstruction] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session?.preview?.mergedContent !== undefined) {
      setLocalDraftContent(session.preview.mergedContent);
    }
  }, [session?.preview?.previewId, session?.preview?.mergedContent]);

  useEffect(() => {
    setAiSourceView('merged');
  }, [session?.conflictId, session?.preview?.previewId]);

  useEffect(() => {
    if (session?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session?.messages?.length, session?.status]);

  if (!session || !session.isOpen) return null;

  const handleCopyPath = () => {
    if (session.relativePath) {
      navigator.clipboard.writeText(session.relativePath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  const handleCopyCode = () => {
    const textToCopy =
      aiSourceView === 'merged'
        ? localDraftContent
        : aiSourceView === 'local'
          ? session.preview?.localContent ?? ''
          : session.preview?.remoteContent ?? '';
    navigator.clipboard.writeText(textToCopy);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleResetToPreview = () => {
    if (session.preview?.mergedContent) {
      setLocalDraftContent(session.preview.mergedContent);
    }
  };

  const handleSendInstruction = async () => {
    if (!agentInstruction.trim() || session.status === 'merging') return;
    const instruction = agentInstruction.trim();
    setAgentInstruction('');
    await onRefine(instruction, localDraftContent);
  };

  const isModified = Boolean(
    session.preview && localDraftContent !== session.preview.mergedContent
  );

  const aiPreview = session.preview;
  const currentViewContent =
    aiSourceView === 'merged'
      ? localDraftContent
      : aiSourceView === 'local'
        ? aiPreview?.localContent ?? ''
        : aiPreview?.remoteContent ?? '';

  const lineCount = currentViewContent ? (currentViewContent.match(/\n/g) || []).length + 1 : 1;
  const charCount = currentViewContent.length;

  const quickChips = [
    '优先采用本地实现的修改',
    '同时保留远端全部代码',
    '远端优先，仅合入本地字段',
    '精简重复项并统一中文注释',
  ];

  const isBusyMerging = session.status === 'merging';
  const isBusyApplying = session.status === 'applying';

  const modalDom = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm dark:bg-black/80 animate-in fade-in duration-150">
      <div className="flex h-[84vh] max-h-[780px] min-h-[540px] w-full max-w-6xl flex-col rounded-2xl border border-slate-200/90 bg-white shadow-soft-lg dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/80 bg-amber-50 text-amber-600 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-300 shadow-soft-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  AI 智能合并与协同审阅
                </h3>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1.5 whitespace-nowrap border ${
                    isBusyMerging || isBusyApplying
                      ? 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                      : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isBusyMerging || isBusyApplying
                        ? 'bg-indigo-500 animate-pulse'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <span>
                    {isBusyMerging
                      ? '分析生成中'
                      : isBusyApplying
                        ? '正在写入'
                        : '就绪'}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 min-w-0">
                <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium border border-slate-200/80 dark:border-slate-700 shrink-0 text-[11px]">
                  {projectName}
                </span>
                <span className="font-mono text-xs text-slate-700 dark:text-slate-300 truncate max-w-[260px] sm:max-w-md select-all">
                  {session.relativePath}
                </span>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  title="复制相对路径"
                  className="p-1 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0"
                >
                  {copiedPath ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {session.preview?.model && (
              <span className="hidden md:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 mr-1">
                <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                <span>{session.preview.model}</span>
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isBusyApplying}
              title="最小化至后台"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={isBusyApplying}
              onClick={() => {
                if (isModified) {
                  setConfirmCancel(true);
                } else {
                  onCancel();
                }
              }}
              title="关闭并放弃合并"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Main Body: 7 Cols Editor + 5 Cols Agent Interaction */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left Column: Code Editor & Version Compare (7 cols) */}
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

          {/* Right Column: Agent Interaction & Chinese Suggestions (5 cols) */}
          <div className="lg:col-span-5 flex flex-col min-h-0 bg-white dark:bg-slate-900">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/40 dark:bg-slate-950/40">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  AI 合并对话与修改指导
                </h4>
              </div>
              {session.messages.length > 0 && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                  {session.messages.length} 条记录
                </span>
              )}
            </div>

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 min-h-0">
              {/* Initial Analysis Loading State (Single Unified Card) */}
              {session.messages.length === 0 && isBusyMerging && (
                <div className="flex items-start gap-2.5 animate-in fade-in duration-150">
                  <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0 mt-0.5">
                    <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                  </div>
                  <div className="flex-1 rounded-xl border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/20 p-3.5 space-y-2.5">
                    <div className="text-xs font-medium text-indigo-900 dark:text-indigo-300">
                      正在比对两端差异并生成合并说明…
                    </div>
                    <div className="space-y-2">
                      <div className="h-2.5 w-4/5 rounded bg-indigo-200/50 dark:bg-indigo-800/40 animate-pulse" />
                      <div className="h-2.5 w-3/5 rounded bg-indigo-200/40 dark:bg-indigo-800/30 animate-pulse" />
                    </div>
                  </div>
                </div>
              )}

              {/* Fallback if messages list is empty but suggestions exist */}
              {session.messages.length === 0 && !isBusyMerging && session.suggestions && (
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/30 p-3.5 text-xs text-slate-800 dark:text-slate-200 leading-relaxed shadow-soft-sm">
                      <div className="font-semibold text-indigo-900 dark:text-indigo-300 mb-1.5 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                        <span>合并建议与差异说明</span>
                      </div>
                      <div className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                        {session.suggestions}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Chat Thread */}
              {session.messages.map((msg, index) => {
                const isInitialSuggestion =
                  msg.id === 'init' || (index === 0 && msg.role === 'assistant');
                if (isInitialSuggestion) {
                  return (
                    <div key={msg.id} className="flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1">
                        <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/30 p-3.5 text-xs text-slate-800 dark:text-slate-200 leading-relaxed shadow-soft-sm">
                          <div className="font-semibold text-indigo-900 dark:text-indigo-300 mb-1.5 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                            <span>合并建议与差异说明</span>
                          </div>
                          <div className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 ${
                      msg.role === 'user' ? 'flex-row-reverse' : ''
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-xs ${
                        msg.role === 'user'
                          ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-soft-sm'
                          : 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <User className="w-3.5 h-3.5" />
                      ) : (
                        <Bot className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div
                      className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white shadow-soft-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                );
              })}

              {/* Follow-up Refine Loading State (only when conversation already exists) */}
              {session.messages.length > 0 && isBusyMerging && (
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0">
                    <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                  </div>
                  <div className="rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs text-slate-600 dark:text-slate-300">
                    正在根据指令微调合并代码…
                  </div>
                </div>
              )}

              {session.error && (
                <div className="rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50/90 dark:bg-rose-950/50 p-3.5 text-xs text-rose-950 dark:text-rose-100 shadow-sm space-y-2.5 animate-in fade-in">
                  <div className="flex items-center gap-2 font-semibold text-rose-900 dark:text-rose-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>执行遇到问题</span>
                  </div>
                  <div className="text-[11px] leading-relaxed pl-6 break-all">
                    {session.error}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-rose-200/80 dark:border-rose-900/60 text-[11px]">
                    <button
                      type="button"
                      onClick={onOpenAiSettings}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                    >
                      前往 AI 设置检查配置 →
                    </button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleSendInstruction()}
                      disabled={isBusyApplying || isBusyMerging}
                      className="bg-white dark:bg-slate-900 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      <span>重试</span>
                    </Button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Directive Chips & Agent Command Input */}
            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-2.5 shrink-0">
              {/* 2x2 Quick Directives Grid */}
              <div className="grid grid-cols-2 gap-1.5">
                {quickChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={isBusyMerging}
                    onClick={() => {
                      setAgentInstruction(chip);
                      inputRef.current?.focus();
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200/90 dark:border-slate-700/90 bg-white dark:bg-slate-800/90 text-left text-[11px] text-slate-600 dark:text-slate-300 hover:border-indigo-400 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors disabled:opacity-40 truncate font-medium"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Prompt Input & Send */}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={agentInstruction}
                  onChange={(e) => setAgentInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendInstruction();
                    }
                  }}
                  disabled={isBusyMerging}
                  placeholder="输入微调指令，如：把第 20 行配置改为远端版本…"
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:opacity-50 transition-all"
                />
                <Button
                  variant="primary"
                  size="md"
                  disabled={!agentInstruction.trim() || isBusyMerging}
                  onClick={() => void handleSendInstruction()}
                  className="gap-1.5 shrink-0 px-3.5 py-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>发送</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/90 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {isModified ? (
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                已手动编辑合并结果
              </span>
            ) : (
              <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px] tabular-nums">
                {lineCount} 行 · {charCount.toLocaleString()} 字符
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              size="md"
              onClick={onClose}
              disabled={isBusyApplying}
              className="gap-1.5"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span>后台暂存</span>
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                if (isModified) {
                  setConfirmCancel(true);
                } else {
                  onCancel();
                }
              }}
              disabled={isBusyApplying}
            >
              放弃合并
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => void onApply(localDraftContent)}
              disabled={isBusyMerging || isBusyApplying || !localDraftContent.trim()}
              className="gap-1.5 shadow-soft-sm"
            >
              {isBusyApplying ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>{isBusyApplying ? '写入两端中…' : '确认写入两端'}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation Sub-Modal for Discarding Edited Content */}
      {confirmCancel && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-soft-lg w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                放弃本次合并修改？
              </h4>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              当前合并结果包含未保存的修改，确认放弃后将清除本次合并会话。
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setConfirmCancel(false)}
              >
                继续编辑
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={() => {
                  setConfirmCancel(false);
                  onCancel();
                }}
              >
                确认放弃
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalDom, document.body);
}
export default AiMergeModal;
