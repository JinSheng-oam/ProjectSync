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

  // Sync draft content whenever session preview updates
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

  const lineCount = (currentViewContent.match(/\n/g) || []).length + 1;
  const charCount = currentViewContent.length;

  const quickChips = [
    '优先采用本地实现的修改',
    '同时保留远端全部代码',
    '远端优先，仅合入本地字段',
    '精简重复项并统一中文注释',
  ];

  const modalDom = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm dark:bg-black/80 animate-in fade-in duration-150">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-200 bg-white shadow-soft-lg dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-3.5 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 shadow-soft-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  AI 智能合并与协同审阅
                </h3>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-medium flex items-center gap-1.5 shadow-soft-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                  <span>
                    {session.status === 'merging'
                      ? 'AI 分析生成中...'
                      : session.status === 'applying'
                        ? '写入两端中...'
                        : 'Agent 协同就绪'}
                  </span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium border border-slate-200 dark:border-slate-700 shrink-0 text-[11px]">
                  {projectName}
                </span>
                <span className="font-mono text-slate-700 dark:text-slate-300 truncate max-w-md select-all">
                  {session.relativePath}
                </span>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  title="复制相对路径"
                  className="p-1 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
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

          <div className="flex items-center gap-2 shrink-0">
            {session.preview?.model && (
              <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 shadow-soft-sm">
                <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                <span>{session.preview.model}</span>
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              title="后台运行并在后台保持（可随时返回）"
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shadow-soft-sm"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (isModified) {
                  setConfirmCancel(true);
                } else {
                  onCancel();
                }
              }}
              title="关闭并放弃本次合并"
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shadow-soft-sm"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Main Body: 7 Cols Editor + 5 Cols Agent Interaction */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left Column: Code Editor & Version Compare (7 cols) */}
          <div className="lg:col-span-7 flex flex-col min-h-0 overflow-hidden bg-slate-50/50 dark:bg-slate-950/40">
            {/* View Switcher & File Stats Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 bg-white dark:bg-slate-900 shrink-0">
              <div className="flex items-center gap-1.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                <button
                  type="button"
                  onClick={() => setAiSourceView('merged')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all font-medium ${
                    aiSourceView === 'merged'
                      ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>合并结果 (可编辑)</span>
                  {isModified && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                </button>
                <button
                  type="button"
                  onClick={() => setAiSourceView('local')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all font-medium ${
                    aiSourceView === 'local'
                      ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>本地原文件 (只读)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAiSourceView('remote')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all font-medium ${
                    aiSourceView === 'remote'
                      ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>远端冲突文件 (只读)</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {charCount} 字符 · {lineCount} 行 · {aiSourceView === 'merged' ? '可编辑' : '只读'}
                </span>
                {aiSourceView === 'merged' && isModified && (
                  <button
                    type="button"
                    onClick={handleResetToPreview}
                    title="重置为 AI 建议初版"
                    className="p-1 rounded text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyCode}
                  title="复制当前文本"
                  className="p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Code / Text Area with Line Numbers */}
            <div className="flex-1 relative overflow-auto p-4 flex font-mono text-xs leading-5">
              {/* Line Numbers Column */}
              <div className="select-none pr-3 text-right text-slate-400 dark:text-slate-600 border-r border-slate-200 dark:border-slate-800 shrink-0 font-mono text-[11px]">
                {Array.from({ length: Math.max(lineCount, 1) }).map((_, i) => (
                  <div key={i} className="leading-5 h-5">
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Editor / Readonly Display Column */}
              <div className="flex-1 pl-3 min-w-0">
                {aiSourceView === 'merged' ? (
                  <textarea
                    value={localDraftContent}
                    onChange={(e) => setLocalDraftContent(e.target.value)}
                    disabled={session.status === 'merging' || session.status === 'applying'}
                    className="w-full h-full min-h-[460px] bg-transparent resize-none border-none outline-none font-mono text-xs text-slate-800 dark:text-slate-200 leading-5 focus:ring-0 p-0 selection:bg-indigo-500/20"
                    placeholder="// 此处显示合并后的代码文件，支持随时手工微调编辑..."
                    spellCheck={false}
                  />
                ) : (
                  <pre className="w-full h-full min-h-[460px] whitespace-pre font-mono text-xs text-slate-700 dark:text-slate-300 leading-5 p-0 select-text m-0">
                    {currentViewContent || (
                      <span className="text-slate-400 italic">内容为空</span>
                    )}
                  </pre>
                )}
              </div>

              {/* Loading overlay on editor while merging */}
              {session.status === 'merging' && (
                <div className="absolute inset-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-[2px] rounded-xl flex flex-col items-center justify-center gap-3 z-10 animate-in fade-in">
                  <LoaderCircle className="w-7 h-7 text-indigo-600 animate-spin" />
                  <div className="text-center">
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      AI 正在执行合并或微调代码...
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      结合双方代码与微调指令进行综合合并
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Agent Interaction & Chinese Suggestions (5 cols) */}
          <div className="lg:col-span-5 flex flex-col min-h-0 bg-white dark:bg-slate-900">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  AI 合并对话与修改指导
                </h4>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                {session.messages.length} 条对话
              </span>
            </div>

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 min-h-[280px]">
              {/* Initial Assistant Message: Chinese Suggestions & Analysis */}
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/30 p-3.5 text-xs text-slate-800 dark:text-slate-200 leading-relaxed shadow-soft-sm">
                    <div className="font-semibold text-indigo-900 dark:text-indigo-300 mb-1 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      <span>AI 合并建议与差异说明</span>
                    </div>
                    <div className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300 text-[12px] leading-relaxed">
                      {session.suggestions || '已自动完成双端差异智能合并，请审阅左侧代码。'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Chat Thread */}
              {session.messages.map((msg) => (
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
              ))}

              {session.status === 'merging' && (
                <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 pl-8">
                  <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                  <span>Agent 正在根据指令微调合并代码...</span>
                </div>
              )}

              {session.error && (
                <div className="rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50/90 dark:bg-rose-950/50 p-4 text-xs text-rose-950 dark:text-rose-100 shadow-sm space-y-2.5 animate-in fade-in">
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
                      onClick={() => handleSendInstruction()}
                      disabled={session.status === 'applying' || session.status === 'merging'}
                      className="bg-white dark:bg-slate-900 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50"
                    >
                      {session.status === 'applying' ? (
                        <LoaderCircle className="w-3.5 h-3.5 animate-spin mr-1" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      )}
                      <span>重试</span>
                    </Button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Directive Chips & Agent Command Input */}
            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-2.5 shrink-0">
              {/* Quick Directive Chips */}
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                <span className="text-slate-400 mr-1 select-none font-medium">快捷指令:</span>
                {quickChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={session.status === 'merging'}
                    onClick={() => {
                      setAgentInstruction(chip);
                      inputRef.current?.focus();
                    }}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-400 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50 shadow-soft-sm font-medium"
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
                  disabled={session.status === 'merging'}
                  placeholder="向 AI 下达调整指令，例如：把第20行配置改为远端..."
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 disabled:opacity-50"
                />
                <Button
                  variant="primary"
                  size="md"
                  disabled={!agentInstruction.trim() || session.status === 'merging'}
                  onClick={() => void handleSendInstruction()}
                  className="gap-1.5 shrink-0 px-4"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>发送指令</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3.5 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/90 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>合并状态在全局后台保持，切换到其他页面后可随时在顶部或冲突列表点击返回。</span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="md"
              onClick={onClose}
              disabled={session.status === 'merging' || session.status === 'applying'}
              className="gap-1.5"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span>后台运行 (暂存)</span>
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
              disabled={session.status === 'merging' || session.status === 'applying'}
            >
              放弃本次合并
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => void onApply(localDraftContent)}
              disabled={
                session.status === 'merging' ||
                session.status === 'applying' ||
                !localDraftContent.trim()
              }
              className="gap-1.5 shadow-soft-sm"
            >
              {session.status === 'applying' ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>{session.status === 'applying' ? '写入两端中…' : '确认写入两端'}</span>
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
              您对代码已做出的修改或 AI 调整尚未保存。放弃后将清除当前会话状态。
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
