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
  Sparkles,
} from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { AiSettingsDto } from '../../types/dto';

import FALLBACK_PROMPT from './default-merge-prompt.txt?raw';

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
        <div className="lg:col-span-12 space-y-5">
          {/* Section 1: API Connection & Models */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  API 接口与模型配置
                </h3>
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
          </section>

          {/* Section 2: Merge Prompt Instructions */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  冲突合并
                </h3>
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
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">合并提示词</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={mergePrompt}
                onChange={(event) => setMergePrompt(event.target.value)}
                className={inputStyle}
              />
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}

function errorMessage(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    return String(reason.message);
  }
  return String(reason);
}
