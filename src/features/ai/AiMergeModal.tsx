import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Cpu, Minimize2, X, Copy, Check, LoaderCircle, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { AiMergeSession } from '../../stores/syncStore';

import { AiMergeEditor } from './AiMergeEditor';
import { AiMergeConversation } from './AiMergeConversation';

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
          <AiMergeEditor
            aiSourceView={aiSourceView}
            setAiSourceView={setAiSourceView}
            isModified={isModified}
            lineCount={lineCount}
            charCount={charCount}
            handleResetToPreview={handleResetToPreview}
            handleCopyCode={handleCopyCode}
            copiedCode={copiedCode}
            localDraftContent={localDraftContent}
            setLocalDraftContent={setLocalDraftContent}
            isBusyMerging={isBusyMerging}
            isBusyApplying={isBusyApplying}
            currentViewContent={currentViewContent}
          />
          <AiMergeConversation
            session={session}
            isBusyMerging={isBusyMerging}
            isBusyApplying={isBusyApplying}
            onOpenAiSettings={onOpenAiSettings}
            handleSendInstruction={handleSendInstruction}
            messagesEndRef={messagesEndRef}
            inputRef={inputRef}
            quickChips={quickChips}
            agentInstruction={agentInstruction}
            setAgentInstruction={setAgentInstruction}
          />
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
