import { useEffect, useState } from 'react';
import { Search, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { SyncRuleDto } from '../../types/dto';
import { api } from '../../services/api';


export function RulePathDiagnostics({ rules }: { rules: SyncRuleDto[] }) {
  // Path diagnostics state
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [checkPath, setCheckPath] = useState('');
  const [checkResult, setCheckResult] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setCheckResult('');
  }, [rules]);

  const handleExplainPath = async () => {
    if (!checkPath.trim()) return;
    setChecking(true);
    try {
      const result = await api.explainSyncRule(checkPath.trim(), rules);
      setCheckResult(result);
    } catch (error: unknown) {
      setCheckResult(
        typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : String(error)
      );
    } finally {
      setChecking(false);
    }
  };
  return (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-800/30">
          <button
            type="button"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-left text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Search className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>路径规则命中诊断</span>
            </span>
            {showDiagnostics ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showDiagnostics && (
            <div className="p-3.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-3">
              <div className="flex gap-2">
                <input
                  id="rule-check-path"
                  value={checkPath}
                  onChange={(e) => {
                    setCheckPath(e.target.value);
                    setCheckResult('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleExplainPath();
                    }
                  }}
                  placeholder="输入项目内相对路径，如 docs/guide.md"
                  className="min-w-0 flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!checkPath.trim() || checking}
                  onClick={handleExplainPath}
                  className="gap-1.5 shrink-0"
                >
                  {checking ? '检查中...' : '检查路径'}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <span>示例:</span>
                {['README.md', 'docs/spec.md', 'node_modules/react', '.env', 'target/debug/app'].map(
                  (sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => {
                        setCheckPath(sample);
                        setCheckResult('');
                      }}
                      className="font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      {sample}
                    </button>
                  )
                )}
              </div>

              {checkResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                    checkResult.includes('【排除】')
                      ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                      : checkResult.includes('【忽略】')
                      ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                      : 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  }`}
                >
                  {checkResult.includes('【排除】') ? (
                    <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  ) : checkResult.includes('【忽略】') ? (
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <div className="font-medium leading-relaxed">{checkResult}</div>
                </div>
              )}
            </div>
          )}
        </div>
  );
}
