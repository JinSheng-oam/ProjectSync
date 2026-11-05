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
  Plus,
  Trash2,
  Sliders,
  History,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { SyncRootDto, SyncRuleDto, SyncFileItemDto, HistoryItemDto } from '../../types/dto';
import { StatusBadge, PathDisplay, Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';

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
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleType, setNewRuleType] = useState<'INCLUDE' | 'EXCLUDE'>('INCLUDE');
  const [rulesDirty, setRulesDirty] = useState(false);

  // Files state
  const [files, setFiles] = useState<SyncFileItemDto[]>([]);

  // History state
  const [historyList, setHistoryList] = useState<HistoryItemDto[]>([]);

  // Advanced settings state
  const [pollInterval, setPollInterval] = useState(root?.pollIntervalSeconds || 30);
  const [debounceMs, setDebounceMs] = useState(root?.debounceMs || 500);

  useEffect(() => {
    if (!root) return;
    setProjectName(root.name);
    setPollInterval(root.pollIntervalSeconds);
    setDebounceMs(root.debounceMs);
  }, [rootId]);

  useEffect(() => {
    if (!root) return;
    api.getSyncRules(root.id).then(setRules);
    api.getFiles(root.id).then(setFiles);
    api.querySyncHistory(root.name).then(setHistoryList);
  }, [root]);

  if (!root) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-500 dark:text-slate-400">未找到对应项目信息</p>
        <Button variant="secondary" size="sm" onClick={onBack} className="mt-3">
          返回总览
        </Button>
      </div>
    );
  }

  const isSyncing = root.status === 'SYNCING';
  const isPaused = root.status === 'PAUSED';
  const isDisabled = root.status === 'DISABLED' || !root.enabled;

  const handleAddRule = () => {
    if (!newRulePattern.trim()) return;
    setRules((prev) => [
      ...prev,
      {
        id: Date.now(),
        ruleType: newRuleType,
        pattern: newRulePattern.trim(),
        enabled: true,
        priority: prev.length * 10 + 10,
      },
    ]);
    setNewRulePattern('');
    setRulesDirty(true);
  };

  const handleRemoveRule = (id?: number) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    setRulesDirty(true);
  };

  const handleSaveRules = async () => {
    try {
      const impact = await api.previewRuleImpact(root.id, rules);
      if (impact.newlyExcluded.length > 0 && !window.confirm(`有 ${impact.newlyExcluded.length} 个本地文件将变为“忽略”。它们的远端副本不会删除。继续保存规则吗？`)) return;
      await api.replaceSyncRules(root.id, rules);
      await api.syncNow(root.id);
      setRulesDirty(false);
      await api.getFiles(root.id).then(setFiles);
      alert('规则已保存，项目状态已重新扫描');
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : '保存规则失败');
    }
  };

  const handleSaveProjectSettings = async () => {
    try {
      await api.updateSyncRoot(root.id, { name: projectName, pollIntervalSeconds: pollInterval, debounceMs });
      alert('项目设置已保存');
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : '保存项目设置失败');
    }
  };

  const handleUnbindProject = async () => {
    if (!window.confirm('解除绑定会停止此项目的监听与同步，不会删除本地文件或 WebDAV 文件。继续吗？')) return;
    try {
      await api.deleteSyncRoot(root.id);
      onBack();
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : '解除绑定失败');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-aerospace-border">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-lg bg-aerospace-elevated border border-aerospace-border flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <Folder className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{root.name}</h2>
              <code className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800">
                {root.remoteProjectId}
              </code>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              本地绑定 ID: {root.id} • 远端 WebDAV: {root.accountId}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={root.status} pulse={isSyncing} />
          {isDisabled ? (
            <Button variant="secondary" size="sm" onClick={async () => { try { await api.enableSyncRoot(root.id); await onRefresh(); } catch (error: unknown) { alert(error instanceof Error ? error.message : '启用同步失败'); } }} className="gap-1 font-mono">
              <Play className="w-3.5 h-3.5 text-emerald-500" />
              启用同步
            </Button>
          ) : isPaused ? (
            <Button variant="secondary" size="sm" onClick={() => onResume(root.id)} className="gap-1 font-mono">
              <Play className="w-3.5 h-3.5 text-emerald-500" />
              恢复同步
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => onPause(root.id)} className="gap-1 font-mono">
              <Pause className="w-3.5 h-3.5 text-amber-500" />
              暂停
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSyncNow(root.id)}
            disabled={isSyncing}
            className="gap-1 font-mono"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            立即同步
          </Button>
        </div>
      </div>

      {/* Tabs Stepped Navigation */}
      <div className="flex items-center gap-2 border-b border-aerospace-border text-xs font-medium">
        {[
          { id: 'overview', label: '项目概览', icon: FileText },
          { id: 'rules', label: '过滤规则', icon: Sliders },
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
              className={`flex items-center gap-2 px-4 py-2.5 border-b-2 transition-all ${
                isActive
                  ? 'border-indigo-600 dark:border-indigo-400 text-indigo-800 dark:text-indigo-300 font-semibold bg-indigo-50/50 dark:bg-aerospace-elevated/40'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/30'
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
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-4 space-y-3 shadow-soft-sm">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>本地工作区目录</span>
              </div>
              <PathDisplay path={root.localPath} />
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                <div>• 本地变动监听: 系统文件监听器 + BLAKE3 哈希</div>
                <div>• 防抖延迟: <span className="font-mono">{root.debounceMs} ms</span></div>
              </div>
            </div>

            <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-4 space-y-3 shadow-soft-sm">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Cloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>远端 WebDAV 路径</span>
              </div>
              <PathDisplay path={root.remotePath} />
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                <div>• 远端轮询检查: 每 <span className="font-mono">{root.pollIntervalSeconds}</span> 秒</div>
                <div>• 根目录标识: <code className="font-mono text-[11px]">.projectsync/root.json</code> 正常</div>
              </div>
            </div>
          </div>

          <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-4 space-y-3 shadow-soft-sm">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>安全与并发保障</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs text-center">
              <div className="bg-slate-50 dark:bg-aerospace-canvas p-3 rounded-lg border border-slate-200 dark:border-aerospace-border">
                <div className="text-slate-500 dark:text-slate-400">冲突策略</div>
                <div className="text-emerald-600 dark:text-emerald-400 font-bold mt-1">保留双端文件</div>
              </div>
              <div className="bg-slate-50 dark:bg-aerospace-canvas p-3 rounded-lg border border-slate-200 dark:border-aerospace-border">
                <div className="text-slate-500 dark:text-slate-400">并发覆写防护</div>
                <div className="text-indigo-600 dark:text-indigo-400 font-bold font-mono mt-1">If-Match / WebDAV LOCK</div>
              </div>
              <div className="bg-slate-50 dark:bg-aerospace-canvas p-3 rounded-lg border border-slate-200 dark:border-aerospace-border">
                <div className="text-slate-500 dark:text-slate-400">本地数据持久化</div>
                <div className="text-slate-800 dark:text-slate-200 font-bold font-mono mt-1">SQLite WAL</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Rules Editor */}
      {activeTab === 'rules' && (
        <div className="space-y-4">
          <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-4 space-y-4 shadow-soft-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">文件过滤规则</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  规则独立保存在数据库中。排除规则优先级高于包含规则，避免 git 仓库或构建产物被同步。
                </p>
              </div>
              {rulesDirty && (
                <Button variant="accent" size="sm" onClick={handleSaveRules}>
                  保存规则变更
                </Button>
              )}
            </div>

            {/* Add Rule Inline */}
            <div className="flex gap-2">
              <select
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value as 'INCLUDE' | 'EXCLUDE')}
                className="bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="INCLUDE">INCLUDE</option>
                <option value="EXCLUDE">EXCLUDE</option>
              </select>
              <input
                type="text"
                value={newRulePattern}
                onChange={(e) => setNewRulePattern(e.target.value)}
                placeholder="Glob 表达式 (例如: docs/**, config/*.toml)"
                className="flex-1 bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <Button variant="secondary" size="sm" onClick={handleAddRule} className="gap-1">
                <Plus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                新增规则
              </Button>
            </div>

            {/* Rules Table */}
            <div className="border border-aerospace-border rounded-xl bg-slate-50/50 dark:bg-aerospace-canvas overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-100 dark:bg-aerospace-rail/80 border-b border-aerospace-border text-slate-600 dark:text-slate-400 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">优先级</th>
                    <th className="py-2.5 px-3">类型</th>
                    <th className="py-2.5 px-3">匹配规则</th>
                    <th className="py-2.5 px-3">状态</th>
                    <th className="py-2.5 px-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-aerospace-border">
                  {rules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-slate-100/60 dark:hover:bg-slate-800/30">
                      <td className="py-2 px-3 text-slate-400 dark:text-slate-500">{rule.priority}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            rule.ruleType === 'INCLUDE'
                              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                              : 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                          }`}
                        >
                          {rule.ruleType}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-800 dark:text-slate-200 font-semibold">{rule.pattern}</td>
                      <td className="py-2 px-3 text-emerald-600 dark:text-emerald-400">已启用</td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveRule(rule.id)}
                          className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Files Ledger */}
      {activeTab === 'files' && (
        <div className="bg-aerospace-surface border border-aerospace-border rounded-xl overflow-hidden shadow-soft-sm">
          <div className="p-3 bg-slate-50 dark:bg-aerospace-rail/70 border-b border-aerospace-border flex items-center justify-between text-xs">
            <span className="text-slate-800 dark:text-slate-300 font-semibold">文件状态清单</span>
            <span className="text-slate-500 dark:text-slate-400">共 <span className="font-mono">{files.length}</span> 个文件</span>
          </div>

          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-100/70 dark:bg-aerospace-canvas border-b border-aerospace-border text-slate-600 dark:text-slate-400 text-[11px]">
              <tr>
                <th className="py-2.5 px-3">相对路径</th>
                <th className="py-2.5 px-3">当前状态</th>
                <th className="py-2.5 px-3">大小</th>
                <th className="py-2.5 px-3">本地修改时间</th>
                <th className="py-2.5 px-3">BLAKE3 摘要</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-aerospace-border">
              {files.map((file, idx) => (
                <tr key={idx} className="hover:bg-slate-100/60 dark:hover:bg-slate-800/30">
                  <td className="py-2 px-3 text-slate-800 dark:text-slate-200 font-medium">{file.relativePath}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        file.status === 'IN_SYNC'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400'
                          : file.status === 'CONFLICT'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-400'
                          : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400'
                      }`}
                    >
                      {file.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{(file.sizeBytes / 1024).toFixed(1)} KB</td>
                  <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                    {new Date(file.localModifiedAt).toLocaleTimeString()}
                  </td>
                  <td className="py-2 px-3 text-slate-400 dark:text-slate-500 text-[10px] truncate max-w-[140px]">
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
        <div className="bg-aerospace-surface border border-aerospace-border rounded-xl overflow-hidden shadow-soft-sm">
          <div className="p-3 bg-slate-50 dark:bg-aerospace-rail/70 border-b border-aerospace-border flex items-center justify-between text-xs">
            <span className="text-slate-800 dark:text-slate-300 font-semibold">同步记录</span>
            <span className="text-slate-500 dark:text-slate-400"><span className="font-mono">{historyList.length}</span> 条记录</span>
          </div>
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-100/70 dark:bg-aerospace-canvas border-b border-aerospace-border text-slate-600 dark:text-slate-400 text-[11px]">
              <tr>
                <th className="py-2.5 px-3">时间</th>
                <th className="py-2.5 px-3">动作</th>
                <th className="py-2.5 px-3">文件路径</th>
                <th className="py-2.5 px-3">状态</th>
                <th className="py-2.5 px-3">数据量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-aerospace-border">
              {historyList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-100/60 dark:hover:bg-slate-800/30">
                  <td className="py-2 px-3 text-slate-400 dark:text-slate-500">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2 px-3 text-indigo-700 dark:text-indigo-400 font-semibold">{item.action}</td>
                  <td className="py-2 px-3 text-slate-800 dark:text-slate-200">{item.relativePath}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        item.status === 'SUCCESS'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400'
                          : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-400'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{(item.bytes / 1024).toFixed(1)} KB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 5: Advanced */}
      {activeTab === 'advanced' && (
        <div className="space-y-4 max-w-2xl">
          <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-5 space-y-4 shadow-soft-sm">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">调度引擎高级参数</h3>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">项目名称</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                远端 WebDAV 轮询扫描周期 (秒)
              </label>
              <input
                type="number"
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
                className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
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
                className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="pt-2">
              <Button
                variant="primary"
                size="md"
                onClick={handleSaveProjectSettings}
              >
                保存参数配置
              </Button>
            </div>
          </div>

          <div className="bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              危险操作区
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-normal">
              解绑该项目将停止本地监听器与远端同步。本地与远端已存在的真实文件均不会被删除，仅移除调度绑定关系。
            </p>
            <Button
              variant="danger"
              size="sm"
              onClick={handleUnbindProject}
            >
              解除项目绑定
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
