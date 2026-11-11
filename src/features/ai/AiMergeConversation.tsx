import { Sparkles, User, Bot, Send, LoaderCircle, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { AiMergeSession, needsFreshMerge } from '../../stores/syncStore';

import type { RefObject } from 'react';

interface AiMergeConversationProps {
  session: AiMergeSession;
  isBusyMerging: boolean;
  isBusyApplying: boolean;
  onOpenAiSettings: () => void;
  handleSendInstruction: () => Promise<void>;
  messagesEndRef: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLInputElement>;
  quickChips: string[];
  agentInstruction: string;
  setAgentInstruction: (instruction: string) => void;
}

export function AiMergeConversation({
  session,
  isBusyMerging,
  isBusyApplying,
  onOpenAiSettings,
  handleSendInstruction,
  messagesEndRef,
  inputRef,
  quickChips,
  agentInstruction,
  setAgentInstruction,
}: AiMergeConversationProps) {
  return (
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
        <div role="alert" className="rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50/90 dark:bg-rose-950/50 p-3.5 text-xs text-rose-950 dark:text-rose-100 shadow-sm space-y-2.5 animate-in fade-in">
          <div className="flex items-center gap-2 font-semibold text-rose-900 dark:text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>执行遇到问题</span>
          </div>
          <div className="text-[11px] leading-relaxed pl-6 break-all">
            {session.error}
          </div>
          {needsFreshMerge(session.error) ? (
            <p>当前草稿已失效。请重新扫描并生成新稿，或跳过此文件。</p>
          ) : /AI_NOT_CONFIGURED|CODEX_NOT_FOUND|CODEX_START_FAILED|AI_SETTINGS_INVALID/.test(session.error) ? (
            <button type="button" onClick={onOpenAiSettings} className="text-indigo-700 underline dark:text-indigo-300">
              检查 AI 设置
            </button>
          ) : null}
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
            disabled={isBusyMerging || isBusyApplying || session.status !== 'ready'}
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
          disabled={isBusyMerging || isBusyApplying || session.status !== 'ready'}
          placeholder="输入微调指令，如：把第 20 行配置改为远端版本…"
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:opacity-50 transition-all"
        />
        <Button
          variant="primary"
          size="md"
          disabled={!agentInstruction.trim() || isBusyMerging || isBusyApplying || session.status !== 'ready'}
          onClick={() => void handleSendInstruction()}
          className="gap-1.5 shrink-0 px-3.5 py-2"
        >
          <Send className="w-3.5 h-3.5" />
          <span>发送</span>
        </Button>
      </div>
    </div>
  </div>
  );
}
