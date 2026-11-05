import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  HelpCircle,
  Cpu,
  Lock,
} from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { AiSettingsDto } from '../../types/dto';

const FALLBACK_PROMPT =
  '合并本地与远端修改，保留双方意图；给出详细的中文合并分析与修改说明；不要引入新事实、删除无关内容或改变文件格式。';

export function AiSettingsView() {
  const [settings, setSettings] = useState<AiSettingsDto | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [mergePrompt, setMergePrompt] = useState(FALLBACK_PROMPT);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [error, setError] = useState('');

  const applySettings = (value: AiSettingsDto) => {
    setSettings(value);
    setEndpoint(value.endpoint);
    setModel(value.model);
    setMergePrompt(value.mergePrompt || FALLBACK_PROMPT);
    setApiKey('');
    setClearApiKey(false);
  };

  useEffect(() => {
    let active = true;
    api
      .getAiSettings()
      .then((value) => {
        if (active) applySettings(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setTestResult('');
    try {
      const result = await api.saveAiSettings({
        endpoint,
        model,
        apiKey: apiKey || undefined,
        clearApiKey,
        mergePrompt,
      });
      applySettings(result);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError('');
    setTestResult('');
    try {
      const result = await api.testAiSettings({
        endpoint: endpoint.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      setTestResult(`${result.message} · 延迟 ${result.latencyMs} ms`);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setTesting(false);
    }
  };

  const handleLoadModels = async () => {
    if (!endpoint.trim()) {
      setError('请先填写 AI 接口地址。');
      return;
    }
    setLoadingModels(true);
    setError('');
    try {
      const result = await api.listAiModels(endpoint.trim(), apiKey.trim() || undefined);
      setModels(result);
      if (!model.trim() && result.length > 0) setModel(result[0]);
      if (result.length === 0) setError('接口已响应，但未返回可用模型列表。');
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoadingModels(false);
    }
  };

  const inputStyle =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none transition-colors focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 font-sans';
  const hasUnsavedChanges = settings
    ? endpoint !== settings.endpoint
      || model !== settings.model
      || mergePrompt !== settings.mergePrompt
      || apiKey.length > 0
      || clearApiKey
    : false;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner Card (Strictly consistent with ProjectManagementView and ConflictCenter) */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900 md:flex-row md:items-center">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              <span>AI 服务与冲突合并设置</span>
              {settings?.configured && (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  已就绪
                </span>
              )}
              {hasUnsavedChanges && (
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  有未保存更改
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              配置 OpenAI 兼容端点、模型密钥与合并提示词，驱动类 Agent 冲突交互合并。
            </p>
          </div>
        </div>
        <Button variant="primary" size="md" onClick={handleSave} disabled={saving} className="gap-2 shrink-0">
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          <span>{saving ? '正在保存…' : saved ? '配置已保存' : '保存 AI 设置'}</span>
        </Button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
      {testResult && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{testResult}</span>
        </div>
      )}
      {testing && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3.5 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>正在测试与模型 {model || '（未填写）'} 的连通性，请稍候...</span>
        </div>
      )}

      {/* Main 2-Column Responsive Workspace Grid (8 cols form + 4 cols information & guidelines) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Form (8 Cols) */}
        <div className="lg:col-span-8 space-y-5">
          {/* Section 1: API Connection & Models */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  API 接口与模型配置
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  支持 OpenAI 官方及所有兼容格式的服务（如 DeepSeek、通义千问、Ollama、SiliconFlow 等）。
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTest}
                disabled={testing || !endpoint.trim() || !model.trim()}
                className="gap-1.5 shrink-0"
              >
                {testing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">接口 Base URL 或完整地址</span>
              <input
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className={`${inputStyle} font-mono`}
              />
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                支持如 https://api.openai.com/v1 或本机 http://localhost:11434/v1。系统会自动适配 /chat/completions。
              </span>
            </label>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>模型标识 (Model)</span>
                  <button
                    type="button"
                    onClick={handleLoadModels}
                    disabled={loadingModels || !endpoint.trim()}
                    className="inline-flex items-center gap-1 text-[11px] font-normal text-indigo-700 disabled:opacity-50 dark:text-indigo-300 hover:underline"
                  >
                    {loadingModels ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    {loadingModels ? '拉取中…' : '从接口拉取模型'}
                  </button>
                </span>
                <input
                  list="ai-model-options"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="gpt-4o-mini 或 deepseek-chat"
                  className={`${inputStyle} font-mono`}
                />
                <datalist id="ai-model-options">
                  {models.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                {models.length > 0 && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    已从接口探测到 {models.length} 个模型。
                  </span>
                )}
              </label>

              <label className="block space-y-1.5">
                <span className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    API 密钥 (API Key, 可选)
                  </span>
                  {settings?.hasApiKey && (
                    <span className="text-[10px] font-normal text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.2 rounded border border-emerald-200 dark:border-emerald-800">
                      已安全加密保存
                    </span>
                  )}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={settings?.hasApiKey ? '留空继续使用已保存密钥' : 'sk-…'}
                  className={`${inputStyle} font-mono`}
                />
              </label>
            </div>

            {settings?.hasApiKey && (
              <label className="flex w-fit items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={(event) => setClearApiKey(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-0 dark:border-slate-600"
                />
                <span>保存时清空并移除当前存储的 API 密钥</span>
              </label>
            )}

            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                API 密钥存入 Windows 凭据管理器（Credential Manager），不会明文写入 SQLite 数据库或返回前端界面。
              </span>
            </div>
          </section>

          {/* Section 2: Merge Prompt Instructions */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  冲突合并系统要求与提示词
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  随冲突双方文本共同发送给模型，用于约束合并行为。生成后支持类 Agent 继续下达修改指令。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMergePrompt(FALLBACK_PROMPT)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
              >
                恢复默认要求
              </button>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">合并系统要求 (Prompt)</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={mergePrompt}
                onChange={(event) => setMergePrompt(event.target.value)}
                className={inputStyle}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
              <PolicyCard label="中文分析建议" value="自动生成决策解释" />
              <PolicyCard label="类 Agent 连续微调" value="支持多轮次交互修改" />
              <PolicyCard label="双端安全备份" value="两端自动移入回收站" />
            </div>
          </section>
        </div>

        {/* Right Info Sidebar (4 Cols) */}
        <div className="lg:col-span-4 space-y-5">
          {/* Card 1: Capabilities */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Cpu className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>AI 冲突合并核心机制</span>
            </div>
            <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-2.5 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">•</span>
                <span>
                  <strong>中文建议与分析</strong>：合并时不仅输出合成文件，还会主动列出差异简述与保留决策，帮助您快速审阅。
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold">•</span>
                <span>
                  <strong>类 Agent 连续交互修改</strong>：如对初步结果不满意，可在审阅抽屉内像对话一样继续下达微调指令。
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-600 font-bold">•</span>
                <span>
                  <strong>后台平稳运行</strong>：合并任务在全局后台执行，即使切换到其他页面，也不会被中断，随时可回退查看。
                </span>
              </li>
            </ul>
          </div>

          {/* Card 2: Compatible Endpoints */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <HelpCircle className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>推荐端点范例</span>
            </div>
            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200">DeepSeek (性价比首选)</div>
                <code className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 block truncate">
                  https://api.deepseek.com/v1
                </code>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200">本地 Ollama (完全私有)</div>
                <code className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 block truncate">
                  http://localhost:11434/v1
                </code>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200">OpenAI 官方</div>
                <code className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 block truncate">
                  https://api.openai.com/v1
                </code>
              </div>
            </div>
          </div>

          {/* Card 3: Security */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900 space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>隐私与安全防线</span>
            </div>
            <p className="leading-relaxed">
              请求直接由本地客户端发送至您所填写的模型地址，不经过任何第三方服务器中转。文件写入前始终先进行条件锁保护，杜绝并发覆盖。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PolicyCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 font-medium text-slate-800 dark:text-slate-200">{value}</div>
    </div>
  );
}

function errorMessage(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    return String(reason.message);
  }
  return String(reason);
}
