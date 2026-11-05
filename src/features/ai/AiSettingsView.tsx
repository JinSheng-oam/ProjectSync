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
} from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { AiSettingsDto } from '../../types/dto';

const FALLBACK_PROMPT =
  '合并本地与远端修改，保留双方意图；不要引入新事实、删除无关内容或改变文件格式。';

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
      setTestResult(`${result.message} · ${result.latencyMs} ms`);
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
      if (result.length === 0) setError('接口已响应，但没有返回可用模型。');
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoadingModels(false);
    }
  };

  const inputStyle =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none transition-colors focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100';
  const hasUnsavedChanges = settings
    ? endpoint !== settings.endpoint
      || model !== settings.model
      || mergePrompt !== settings.mergePrompt
      || apiKey.length > 0
      || clearApiKey
    : false;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900 md:flex-row md:items-center">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              AI 服务与冲突合并
              {settings?.configured && (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  已配置
                </span>
              )}
              {hasUnsavedChanges && (
                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  有未保存更改
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              统一管理 OpenAI 兼容接口、密钥和冲突合并偏好。
            </p>
          </div>
        </div>
        <Button variant="primary" size="md" onClick={handleSave} disabled={saving} className="gap-2 shrink-0">
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          <span>{saving ? '正在保存…' : saved ? '已保存' : '保存 AI 设置'}</span>
        </Button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
      {testResult && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{testResult}</span>
        </div>
      )}
      {testing && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>正在使用当前输入的模型 {model || '（未填写）'} 测试，最多等待 25 秒。</span>
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              API 连接
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              可填基础地址或完整 Chat Completions 地址，系统会自动补全请求路径。本机地址可使用 HTTP，其他地址必须使用 HTTPS。
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing || !endpoint.trim() || !model.trim()} className="gap-1.5 shrink-0">
            {testing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {testing ? '测试中…' : '测试连接'}
          </Button>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">API 地址</span>
          <input
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="https://api.openai.com/v1"
            className={`${inputStyle} font-mono`}
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            例如只填 https://api.openai.com/v1；完整 .../chat/completions 地址也可直接使用。
          </span>
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
              <span>模型名称</span>
              <button
                type="button"
                onClick={handleLoadModels}
                disabled={loadingModels || !endpoint.trim()}
                className="inline-flex items-center gap-1 text-[11px] font-normal text-indigo-700 disabled:opacity-50 dark:text-indigo-300"
              >
                {loadingModels ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {loadingModels ? '拉取中…' : '拉取模型'}
              </button>
            </span>
            <input
              list="ai-model-options"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="gpt-4o-mini"
              className={`${inputStyle} font-mono`}
            />
            <datalist id="ai-model-options">
              {models.map((item) => <option key={item} value={item} />)}
            </datalist>
            {models.length > 0 && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                已获取 {models.length} 个模型，可从列表选择或继续手动输入。
              </span>
            )}
          </label>
          <label className="block space-y-1.5">
            <span className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />API 密钥（可选）</span>
              {settings?.hasApiKey && (
                <span className="text-[10px] font-normal text-emerald-700 dark:text-emerald-300">已安全保存</span>
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
          <label className="flex w-fit items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-0 dark:border-slate-600"
            />
            保存时移除已存 API 密钥
          </label>
        )}

        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>API 密钥存入 Windows 凭据管理器，不会写入数据库或返回界面。AI 功能只在你点击对应按钮时联网。</span>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Sparkles className="h-4 w-4 text-amber-500" />
            冲突合并要求
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            这段要求会随本地和远端文本一起发送给模型。生成结果后仍需人工审阅并确认写入。
          </p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">合并提示词</span>
          <textarea
            rows={4}
            maxLength={4000}
            value={mergePrompt}
            onChange={(event) => setMergePrompt(event.target.value)}
            className={inputStyle}
          />
        </label>
        <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
          <PolicyCard label="人工确认" value="预览后写入" />
          <PolicyCard label="文本限制" value="每侧 64 KiB" />
          <PolicyCard label="原始版本" value="自动备份" />
        </div>
      </section>
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
