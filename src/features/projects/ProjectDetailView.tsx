import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  Play,
  Pause,
  Folder,
  HardDrive,
  Cloud,
  FileCode,
  ShieldCheck,
  Sliders,
  Filter,
  History,
  FileText,
  AlertTriangle,
  Fingerprint,
} from 'lucide-react';
import {
  SyncRootDto,
  SyncRuleDto,
  SyncFileItemDto,
  HistoryItemDto,
  RuleImpactDto,
} from '../../types/dto';
import {
  StatusBadge,
  PathDisplay,
  Button,
  formatDisplayPath,
} from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { RuleEditor } from '../rules/RuleEditor';

interface ProjectDetailViewProps {
  rootId: string;
  roots: SyncRootDto[];
  onBack: () => void;
  onSyncNow: (rootId: string) => void;
  onPause: (rootId: string) => void;
  onResume: (rootId: string) => void;
  onRefresh: () => void;
}

export function ProjectDetailView({
  rootId,
  roots,
  onBack,
  onSyncNow,
  onPause,
  onResume,
  onRefresh,
}: ProjectDetailViewProps) {
  const root = roots.find((r) => r.id === rootId);
  const [activeTab, setActiveTab] = useState<'overview' | 'rules' | 'files' | 'history' | 'advanced'>('overview');
  const [projectName, setProjectName] = useState(root?.name || '');

  // Rules state
  const [rules, setRules] = useState<SyncRuleDto[]>([]);
  const [ruleImpact, setRuleImpact] = useState<RuleImpactDto | null>(null);
  const [ruleError, setRuleError] = useState('');
  const [ruleBusy, setRuleBusy] = useState(false);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);

  // Files state
  const [files, setFiles] = useState<SyncFileItemDto[]>([]);

  // History state
  const [historyList, setHistoryList] = useState<HistoryItemDto[]>([]);

  // Advanced settings state
  const [pollInterval, setPollInterval] = useState(root?.pollIntervalSeconds || 30);
  const [debounceMs, setDebounceMs] = useState(root?.debounceMs || 500);
  const [excludeGitTracked, setExcludeGitTracked] = useState(root?.excludeGitTracked ?? false);

  useEffect(() => {
    if (!root) return;
    setProjectName(root.name);
    setPollInterval(root.pollIntervalSeconds);
    setDebounceMs(root.debounceMs);
    setExcludeGitTracked(root.excludeGitTracked);
  }, [rootId]);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    setRulesLoaded(false);
    setRulesDirty(false);
    setRuleImpact(null);
    setRuleError('');
    api
      .getSyncRules(root.id)
      .then((loaded) => {
        if (!cancelled) {
          setRules(loaded);
          setRulesLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setRuleError(`无法加载规则：${ruleErrorMessage(error)}`);
      });
    api.getFiles(root.id).then(setFiles);
    api.querySyncHistory(root.name).then(setHistoryList);
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  if (!root) {
    return (
      <div className="text-center py-12">
        <p className="text-xs text-slate-500 dark:text-slate-400">未找到对应项目信息</p>
        <Button variant="secondary" size="sm" onClick={onBack} className="mt-3">
          返回总览
        </Button>
      </div>
    );
  }

  const isSyncing = root.status === 'SYNCING';
  const isPaused = root.status === 'PAUSED';
  const isDisabled = root.status === 'DISABLED' || !root.enabled;

  const handleRulesChange = (next: SyncRuleDto[]) => {
    setRules(next);
    setRulesDirty(true);
    setRuleImpact(null);
    setRuleError('');
  };

  const handlePreviewRules = async () => {
    setRuleBusy(true);
    setRuleError('');
    setRuleImpact(null);
    try {
      setRuleImpact(await api.previewRuleImpact(root.id, rules));
    } catch (error: unknown) {
      setRuleError(ruleErrorMessage(error));
    } finally {
      setRuleBusy(false);
    }
  };

  const handleSaveRules = async () => {
    setRuleBusy(true);
    setRuleError('');
    try {
      await api.replaceSyncRules(root.id, rules);
      setRulesDirty(false);
      setRuleImpact(null);
    } catch (error: unknown) {
      setRuleError(ruleErrorMessage(error));
    } finally {
      setRuleBusy(false);
    }
  };

  const handleSaveProjectSettings = async () => {
    try {
      await api.updateSyncRoot(root.id, {
        name: projectName.trim() || root.name,
        pollIntervalSeconds: Math.max(5, pollInterval),
        debounceMs: Math.max(100, debounceMs),
        excludeGitTracked,
      });
      await onRefresh();
      alert('项目参数已成功保存');
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : '保存项目设置失败');
    }
  };

  const handleUnbindProject = async () => {
    if (
      !window.confirm(
        `确认解除绑定项目“${root.name}”？本地真实文件与 WebDAV 上的文件均不会被删除，仅停止同步监听。`
      )
    )
      return;
    try {
      await api.deleteSyncRoot(root.id);
      await onRefresh();
      onBack();
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : '解除绑定失败');
    }
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            title="返回列表"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-indigo-50/80 dark:bg-slate-800 border border-indigo-200/70 dark:border-slate-700 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <Folder className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                {root.name}
              </h2>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200/80 dark:border-slate-700 shrink-0">
                轮询 {root.pollIntervalSeconds}s
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-mono mt-1 min-w-0">
              <span className="inline-flex items-center gap-1 truncate max-w-[280px] sm:max-w-[380px]">
                <HardDrive className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{formatDisplayPath(root.localPath)}</span>
              </span>
              <span className="text-slate-300 dark:text-slate-700 shrink-0">•</span>
              <span className="inline-flex items-center gap-1 truncate max-w-[220px] sm:max-w-[300px]">
                <Cloud className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="truncate">{root.remotePath}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={root.status} pulse={isSyncing} />
          {isDisabled ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await api.enableSyncRoot(root.id);
                  await onRefresh();
                } catch (error: unknown) {
                  alert(error instanceof Error ? error.message : '启用同步失败');
                }
              }}
              className="gap-1.5"
            >
              <Play className="w-3.5 h-3.5 text-emerald-600" />
              <span>启用同步</span>
            </Button>
          ) : isPaused ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onResume(root.id)}
              className="gap-1.5"
            >
              <Play className="w-3.5 h-3.5 text-emerald-600" />
              <span>恢复同步</span>
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onPause(root.id)}
              className="gap-1.5"
            >
              <Pause className="w-3.5 h-3.5 text-amber-600" />
              <span>暂停</span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSyncNow(root.id)}
            disabled={isSyncing}
            className="gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>立即同步</span>
          </Button>
        </div>
      </div>

      {/* Tabs Stepped Navigation */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 text-xs font-medium">
        {[
          { id: 'overview', label: '项目概览', icon: FileText },
          { id: 'rules', label: '过滤规则', icon: Filter },
          { id: 'files', label: '文件清单', icon: FileCode },
          { id: 'history', label: '同步历史', icon: History },
          { id: 'advanced', label: '高级设置', icon: Sliders },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 transition-all whitespace-nowrap ${
                isActive
                  ? 'border-indigo-600 dark:border-indigo-400 text-indigo-700 dark:text-indigo-300 font-semibold bg-indigo-50/50 dark:bg-slate-800/40'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/30'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-soft-sm">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>本地工作区目录</span>
              </div>
              <PathDisplay path={root.localPath} />
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <div>• 本地变动监听: 系统文件监听器 + BLAKE3 哈希</div>
                <div>
                  • 防抖延迟:{' '}
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {root.debounceMs} ms
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-soft-sm">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Cloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>远端 WebDAV 路径</span>
              </div>
              <PathDisplay path={root.remotePath} />
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <div>
                  • 远端轮询检查: 每{' '}
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {root.pollIntervalSeconds}
                  </span>{' '}
                  秒
                </div>
                <div>
                  • 根目录标识:{' '}
                  <code className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    .projectsync/root.json
                  </code>{' '}
                  正常
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-soft-sm">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>安全与并发保障</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs text-center">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="text-slate-500 dark:text-slate-400">冲突策略</div>
                <div className="text-emerald-700 dark:text-emerald-300 font-semibold mt-1">
                  保留双端文件
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="text-slate-500 dark:text-slate-400">并发覆写防护</div>
                <div className="text-indigo-700 dark:text-indigo-300 font-semibold font-mono mt-1">
                  If-Match / WebDAV LOCK
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="text-slate-500 dark:text-slate-400">本地数据持久化</div>
                <div className="text-slate-800 dark:text-slate-200 font-semibold font-mono mt-1">
                  SQLite WAL
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Rules */}
      {activeTab === 'rules' && (
        <div className="w-full space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              文件过滤规则
            </h3>
            {rulesDirty && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  {ruleBusy ? '正在处理…' : '有未保存的更改'}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePreviewRules}
                  disabled={ruleBusy}
                >
                  预览本地影响
                </Button>
                <Button
                  variant="accent"
                  size="sm"
                  onClick={handleSaveRules}
                  disabled={ruleBusy}
                >
                  保存规则变更
                </Button>
              </div>
            )}
          </div>

          {rulesLoaded ? (
            <fieldset disabled={ruleBusy}>
              <RuleEditor
                rules={rules}
                onChange={handleRulesChange}
                localPath={root.localPath}
              />
            </fieldset>
          ) : (
            !ruleError && (
              <p className="text-xs text-slate-600 dark:text-slate-400">正在加载规则…</p>
            )
          )}

          {ruleError && (
            <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">
              {ruleError}
            </p>
          )}

          {ruleImpact && (
            <div
              className="space-y-2 rounded-xl bg-slate-50 p-3.5 text-xs dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              role="status"
            >
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                本地文件影响：新增 {ruleImpact.newlyIncluded.length} 项，排除{' '}
                {ruleImpact.newlyExcluded.length} 项，未改变 {ruleImpact.unchanged} 项
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                仅比较当前本地文件；远端文件以同步扫描结果为准。
              </p>
              {(
                [
                  ['新增同步', ruleImpact.newlyIncluded],
                  ['不再同步', ruleImpact.newlyExcluded],
                ] as const
              ).map(
                ([label, paths]) =>
                  paths.length > 0 && (
                    <details key={label}>
                      <summary className="cursor-pointer text-slate-700 dark:text-slate-300">
                        {label}（{paths.length}）
                      </summary>
                      <ul className="mt-1 max-h-40 overflow-auto font-mono text-slate-600 dark:text-slate-400">
                        {paths.map((path) => (
                          <li key={path} className="break-all">
                            {path}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Files Ledger */}
      {activeTab === 'files' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-soft-sm">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-900 dark:text-slate-100 font-semibold">
              文件状态清单
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              共{' '}
              <span className="font-mono text-slate-800 dark:text-slate-200 font-medium">
                {files.length}
              </span>{' '}
              个文件
            </span>
          </div>

          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-[11px]">
              <tr>
                <th className="py-2.5 px-3">相对路径</th>
                <th className="py-2.5 px-3">当前状态</th>
                <th className="py-2.5 px-3">大小</th>
                <th className="py-2.5 px-3">本地修改时间</th>
                <th className="py-2.5 px-3">BLAKE3 摘要</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {files.map((file, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2 px-3 text-slate-900 dark:text-slate-100 font-medium">
                    {file.relativePath}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                        file.status === 'IN_SYNC'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : file.status === 'CONFLICT'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300'
                          : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300'
                      }`}
                    >
                      {file.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                    {(file.sizeBytes / 1024).toFixed(1)} KB
                  </td>
                  <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                    {new Date(file.localModifiedAt).toLocaleTimeString()}
                  </td>
                  <td className="py-2 px-3 text-slate-500 dark:text-slate-400 text-[11px] truncate max-w-[140px]">
                    {file.blake3Hash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: History */}
      {activeTab === 'history' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-soft-sm">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-900 dark:text-slate-100 font-semibold">同步记录</span>
            <span className="text-slate-500 dark:text-slate-400">
              <span className="font-mono text-slate-800 dark:text-slate-200 font-medium">
                {historyList.length}
              </span>{' '}
              条记录
            </span>
          </div>
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-[11px]">
              <tr>
                <th className="py-2.5 px-3">时间</th>
                <th className="py-2.5 px-3">动作</th>
                <th className="py-2.5 px-3">文件路径</th>
                <th className="py-2.5 px-3">状态</th>
                <th className="py-2.5 px-3">数据量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {historyList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2 px-3 text-indigo-700 dark:text-indigo-300 font-semibold">
                    {item.action}
                  </td>
                  <td className="py-2 px-3 text-slate-900 dark:text-slate-100">
                    {item.relativePath}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                        item.status === 'SUCCESS'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                    {(item.bytes / 1024).toFixed(1)} KB
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 5: Advanced */}
      {activeTab === 'advanced' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left 7 Cols: Engine Parameters */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-soft-sm">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              调度引擎高级参数
            </h3>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                项目名称
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  远端 WebDAV 轮询扫描周期 (秒)
                </label>
                <input
                  type="number"
                  value={pollInterval}
                  onChange={(e) => setPollInterval(Number(e.target.value))}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  本地文件监听防抖动延迟 (Debounce 毫秒)
                </label>
                <input
                  type="number"
                  value={debounceMs}
                  onChange={(e) => setDebounceMs(Number(e.target.value))}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3.5 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
              <input
                type="checkbox"
                checked={excludeGitTracked}
                onChange={(event) => setExcludeGitTracked(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-indigo-600"
              />
              <span className="space-y-0.5">
                <span className="block text-xs font-medium text-slate-800 dark:text-slate-100">
                  排除 Git 已跟踪文件
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  下次同步生效，仅限本机，需安装 Git
                </span>
              </span>
            </label>

            <div className="pt-1">
              <Button variant="primary" size="md" onClick={handleSaveProjectSettings}>
                保存参数配置
              </Button>
            </div>
          </div>

          {/* Right 5 Cols: Binding Identifiers & Danger Zone */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 shadow-soft-sm">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>绑定元数据标识</span>
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">远端项目 ID</span>
                  <code className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate select-all">
                    {root.remoteProjectId}
                  </code>
                </div>
                <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">本地绑定 ID</span>
                  <code className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate select-all">
                    {root.id}
                  </code>
                </div>
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">WebDAV 节点 ID</span>
                  <code className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate select-all">
                    {root.accountId}
                  </code>
                </div>
              </div>
            </div>

            <div className="bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 rounded-2xl p-5 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>危险操作区</span>
                </h3>
                <p className="text-[11px] text-rose-700/80 dark:text-rose-300/70">
                  停止同步监听，不删除双端实际文件
                </p>
              </div>

              <Button variant="danger" size="sm" onClick={handleUnbindProject}>
                解除项目绑定
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ruleErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error)
    return String(error.message);
  return String(error || '规则操作失败，请重试');
}
