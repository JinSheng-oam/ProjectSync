import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, ScanLine, Bot, Check, AlertCircle } from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { SyncRuleDto } from '../../types/dto';
import { api } from '../../services/api';

export function AiScope({
  localPath,
  onApply,
}: {
  localPath: string;
  onApply: (rules: SyncRuleDto[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [instruction, setInstruction] = useState('同步文档、AI 规则和项目配置，排除依赖、缓存和敏感文件');
  const [paths, setPaths] = useState<string[] | null>(null);
  const [proposal, setProposal] = useState<SyncRuleDto[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: 'scan' | 'suggest') => {
    setBusy(true);
    setError('');
    try {
      if (!api.isTauri) {
        if (action === 'scan') {
          setProposal(null);
          setPaths([
            'README.md',
            'package.json',
            'docs/overview.md',
            'docs/api.md',
            '.cursor/rules/general.mdc',
            'src/main.tsx',
            'node_modules/vite',
            'dist/index.html',
          ]);
        } else {
          setProposal([
            { id: -1, ruleType: 'INCLUDE', pattern: '**/*.md', enabled: true, priority: 10 },
            { id: -2, ruleType: 'INCLUDE', pattern: '**/*.mdc', enabled: true, priority: 20 },
            { id: -3, ruleType: 'INCLUDE', pattern: '**/docs/**', enabled: true, priority: 30 },
            { id: -4, ruleType: 'EXCLUDE', pattern: '**/node_modules/**', enabled: true, priority: 40 },
            { id: -5, ruleType: 'EXCLUDE', pattern: '**/dist/**', enabled: true, priority: 50 },
          ]);
        }
        return;
      }

      const { invoke } = await import('@tauri-apps/api/core');
      if (action === 'scan') {
        setProposal(null);
        setPaths(await invoke<string[]>('list_ai_scope_paths', { localPath }));
      } else {
        setProposal(
          await invoke<SyncRuleDto[]>('suggest_ai_scope', {
            input: { endpoint, model, apiKey, instruction, paths },
          })
        );
      }
    } catch (e: unknown) {
      setError(typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle =
    'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 font-sans';

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-800/30">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3.5 py-2.5 flex items-center justify-between text-left text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span>使用 AI 推荐同步范围</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            实验特性
          </span>
        </span>
        {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {isOpen && (
        <div className="p-3.5 pt-0 space-y-3 text-xs">
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
            先扫描本地目录清单，再将相对路径与自定义需求发送给指定 OpenAI 兼容接口；不会上传具体文件内容。API 密钥仅用于本次分析，不持久化保存。
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                Chat Completions 完整接口地址
              </span>
              <input
                className={inputStyle}
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://api.openai.com/v1/chat/completions"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                模型标识 (Model)
              </span>
              <input
                className={inputStyle}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini 或 claude-3-5-sonnet"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
              API 密钥 (API Key, 可选)
            </span>
            <input
              type="password"
              autoComplete="off"
              className={inputStyle}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
              同步过滤需求描述
            </span>
            <textarea
              rows={2}
              className={inputStyle}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !localPath.trim()}
              onClick={() => run('scan')}
              className="gap-1.5"
            >
              <ScanLine className="w-3.5 h-3.5" />
              {busy && !paths ? '扫描中...' : '扫描项目目录清单'}
            </Button>
          </div>

          {paths && (
            <div className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-white dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  检测到 {paths.length} 项相对路径（请确认不含私密路径名称）：
                </span>
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 dark:bg-slate-800 p-2 font-mono text-[11px] text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50">
                {paths.join('\n') || '目录为空'}
              </pre>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !endpoint.trim() || !model.trim()}
                onClick={() => run('suggest')}
                className="gap-1.5"
              >
                <Bot className="w-3.5 h-3.5" />
                {busy ? '正在请求 AI 模型分析…' : '发送目录清单并生成规则建议'}
              </Button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {proposal && (
            <div className="space-y-2.5 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30">
              <div className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>AI 建议规则（共 {proposal.length} 条，应用后将替换当前规则）:</span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {proposal.map((rule, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 font-mono text-xs bg-white/80 dark:bg-slate-800/80 px-2 py-1 rounded border border-emerald-200/60 dark:border-emerald-800/60"
                  >
                    <span
                      className={`text-[10px] px-1 rounded ${
                        rule.ruleType === 'INCLUDE'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'
                      }`}
                    >
                      {rule.ruleType === 'INCLUDE' ? '包含' : '排除'}
                    </span>
                    <span className="text-slate-800 dark:text-slate-200 truncate">{rule.pattern}</span>
                  </div>
                ))}
              </div>
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  onApply(proposal);
                  setProposal(null);
                }}
                className="gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                应用 AI 建议规则
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
