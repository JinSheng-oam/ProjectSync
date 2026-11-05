import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  ScanLine,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { AiSettingsDto, SyncRuleDto } from '../../types/dto';

export function AiScope({
  localPath,
  onApply,
}: {
  localPath: string;
  onApply: (rules: SyncRuleDto[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettingsDto | null>(null);
  const [instruction, setInstruction] = useState(
    '同步文档、AI 规则和项目配置，排除依赖、缓存和敏感文件'
  );
  const [paths, setPaths] = useState<string[] | null>(null);
  const [proposal, setProposal] = useState<SyncRuleDto[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getAiSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {
        if (active) setSettings(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (action: 'scan' | 'suggest') => {
    setBusy(true);
    setError('');
    try {
      if (action === 'scan') {
        setProposal(null);
        setPaths(await api.listAiScopePaths(localPath));
      } else if (paths) {
        setProposal(await api.suggestAiScope(instruction, paths));
      }
    } catch (reason: unknown) {
      setError(
        typeof reason === 'object' && reason !== null && 'message' in reason
          ? String(reason.message)
          : String(reason)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/30 dark:border-amber-800/60 dark:bg-amber-950/10">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs font-semibold text-slate-800 transition-colors hover:bg-amber-50/80 dark:text-slate-200 dark:hover:bg-amber-950/20"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span>使用 AI 推荐同步范围</span>
          <span className="rounded border border-amber-200 bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
            AI
          </span>
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {isOpen && (
        <div className="space-y-3 border-t border-amber-200/60 p-3.5 text-xs dark:border-amber-900/50">
          {settings?.configured ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
              <span className="flex items-center gap-1.5">
                <Bot className="h-4 w-4" />
                使用 {settings.model}
              </span>
              <code className="max-w-full truncate text-[10px] opacity-75">{settings.endpoint}</code>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex items-center gap-2 font-semibold">
                <Settings2 className="h-4 w-4" />
                先配置 AI 服务
              </div>
              <p className="leading-relaxed">
                API 地址、模型和密钥已移至左侧“AI 设置”。保存后返回此页，即可分析同步范围。
              </p>
            </div>
          )}

          <p className="leading-relaxed text-slate-600 dark:text-slate-400">
            扫描只会收集项目相对路径；点击“生成规则建议”后，路径清单和需求会发送给已配置的 AI 服务，不会上传文件内容。
          </p>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">同步过滤需求</span>
            <textarea
              rows={2}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>

          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !localPath.trim()}
            onClick={() => run('scan')}
            className="gap-1.5"
          >
            <ScanLine className="h-3.5 w-3.5" />
            {busy && !paths ? '扫描中…' : '扫描项目目录清单'}
          </Button>

          {paths && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                将发送 {paths.length} 项相对路径，请确认不含私密路径名称：
              </span>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200/60 bg-slate-50 p-2 font-mono text-[11px] text-slate-700 dark:border-slate-700/60 dark:bg-slate-800 dark:text-slate-300">
                {paths.join('\n') || '目录为空'}
              </pre>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !settings?.configured}
                onClick={() => run('suggest')}
                className="gap-1.5"
              >
                <Bot className="h-3.5 w-3.5" />
                {busy ? 'AI 正在分析…' : '发送路径并生成规则建议'}
              </Button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {proposal && (
            <div className="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-900 dark:text-emerald-200">
                <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                AI 建议规则（{proposal.length} 条）
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {proposal.map((rule, index) => (
                  <div
                    key={`${rule.pattern}-${index}`}
                    className="flex items-center gap-2 rounded border border-emerald-200/60 bg-white/80 px-2 py-1 font-mono text-xs dark:border-emerald-800/60 dark:bg-slate-800/80"
                  >
                    <span
                      className={`rounded px-1 text-[10px] ${
                        rule.ruleType === 'INCLUDE'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'
                      }`}
                    >
                      {rule.ruleType === 'INCLUDE' ? '包含' : '排除'}
                    </span>
                    <span className="truncate text-slate-800 dark:text-slate-200">{rule.pattern}</span>
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
                <Check className="h-3.5 w-3.5" />
                应用 AI 建议规则
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
