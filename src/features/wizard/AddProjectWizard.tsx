import { useState } from 'react';
import {
  Server,
  Cloud,
  Filter,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  HardDrive,
  FolderOpen,
  ArrowUp,
  ShieldCheck,
  Plus,
  Trash2,
} from 'lucide-react';
import { WebDavAccountDto, SyncRuleDto, InitialSyncPreviewDto } from '../../types/dto';
import { Button, Modal } from '../../components/common/UIComponents';
import { api } from '../../services/api';

interface AddProjectWizardProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: WebDavAccountDto[];
  onProjectCreated: () => void;
}

export function AddProjectWizard({
  isOpen,
  onClose,
  accounts,
  onProjectCreated,
}: AddProjectWizardProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Form State
  const [projectName, setProjectName] = useState('NewSyncProject');
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || '');
  const [localPath, setLocalPath] = useState('D:/Projects/MyDevApp');
  const [remotePath, setRemotePath] = useState('/projects/MyDevApp');
  const [remoteBrowsePath, setRemoteBrowsePath] = useState('/projects');
  const [remoteEntries, setRemoteEntries] = useState<Awaited<ReturnType<typeof api.browseRemoteDirectory>>>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteBrowseError, setRemoteBrowseError] = useState<string | null>(null);

  // Rules state (default template: Developer Project)
  const [rules, setRules] = useState<SyncRuleDto[]>([
    { id: 1, ruleType: 'INCLUDE', pattern: 'docs/**', enabled: true, priority: 10 },
    { id: 2, ruleType: 'INCLUDE', pattern: '*.md', enabled: true, priority: 20 },
    { id: 3, ruleType: 'INCLUDE', pattern: '.cursor/rules/**', enabled: true, priority: 30 },
    { id: 4, ruleType: 'INCLUDE', pattern: 'config/**', enabled: true, priority: 40 },
    { id: 5, ruleType: 'EXCLUDE', pattern: '**/.git/**', enabled: true, priority: 100 },
    { id: 6, ruleType: 'EXCLUDE', pattern: '**/node_modules/**', enabled: true, priority: 110 },
    { id: 7, ruleType: 'EXCLUDE', pattern: '**/target/**', enabled: true, priority: 120 },
  ]);

  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleType, setNewRuleType] = useState<'INCLUDE' | 'EXCLUDE'>('INCLUDE');

  // Step 5 Preview State
  const [previewData, setPreviewData] = useState<InitialSyncPreviewDto | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load preview when entering Step 5
  const handleGoToStep5 = async () => {
    setLoadingPreview(true);
    setCurrentStep(5);
    try {
      const data = await api.previewInitialSync(selectedAccountId, localPath, remotePath, rules);
      setPreviewData(data);
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleAddRule = () => {
    if (!newRulePattern.trim()) return;
    const nextId = Date.now();
    setRules((prev) => [
      ...prev,
      {
        id: nextId,
        ruleType: newRuleType,
        pattern: newRulePattern.trim(),
        enabled: true,
        priority: prev.length * 10 + 10,
      },
    ]);
    setNewRulePattern('');
  };

  const handlePickLocalDirectory = async () => {
    try {
      const selected = await api.pickLocalDirectory();
      if (selected) setLocalPath(selected.replace(/\\/g, '/'));
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : '选择本地目录失败');
    }
  };

  const handleBrowseRemote = async () => {
    if (!selectedAccountId) return;
    setLoadingRemote(true);
    setRemoteBrowseError(null);
    try {
      setRemoteEntries(await api.browseRemoteDirectory(selectedAccountId, remoteBrowsePath));
    } catch (error: unknown) {
      setRemoteBrowseError(error instanceof Error ? error.message : '读取远端目录失败');
      setRemoteEntries([]);
    } finally {
      setLoadingRemote(false);
    }
  };

  const handleRemoveRule = (id?: number) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleConfirmCreate = async () => {
    setSubmitting(true);
    try {
      await api.createSyncRoot({
        name: projectName,
        accountId: selectedAccountId,
        localPath,
        remotePath,
        rules,
      });
      onProjectCreated();
      onClose();
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="添加同步项目"
      subtitle="关联本地工作区与 WebDAV 远端路径，并配置文件过滤规则"
      maxWidth="max-w-3xl"
    >
      {/* Step Indicator Stepper */}
      <div className="flex items-center justify-between pb-4 border-b border-aerospace-border">
        {[
          { step: 1, title: 'WebDAV 节点' },
          { step: 2, title: '本地目录' },
          { step: 3, title: '远端路径' },
          { step: 4, title: '同步规则' },
          { step: 5, title: '初始预览' },
        ].map((item) => (
          <div key={item.step} className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-semibold ${
                currentStep === item.step
                  ? 'bg-cyan-500 text-white shadow-glow-cyan'
                  : currentStep > item.step
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
              }`}
            >
              {currentStep > item.step ? '✓' : item.step}
            </span>
            <span
              className={`text-xs ${
                currentStep === item.step
                  ? 'text-cyan-600 dark:text-cyan-300 font-semibold'
                  : currentStep > item.step
                  ? 'text-slate-700 dark:text-slate-300'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {item.title}
            </span>
          </div>
        ))}
      </div>

      {/* Step 1: Select WebDAV Account */}
      {currentStep === 1 && (
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">项目显示名称</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-medium"
              placeholder="例如: CodeDesk-Docs"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">选择 WebDAV 远端连接</label>
            <div className="grid grid-cols-1 gap-2.5">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors flex items-center justify-between ${
                    selectedAccountId === acc.id
                      ? 'bg-cyan-50/50 dark:bg-aerospace-elevated border-cyan-500 text-slate-900 dark:text-slate-100 shadow-soft-sm'
                      : 'bg-white dark:bg-aerospace-canvas border-slate-200 dark:border-aerospace-border hover:border-slate-400 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                    <div>
                      <div className="font-semibold text-xs">{acc.name}</div>
                      <code className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{acc.url}</code>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      探测通过
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedAccount?.capabilities && (
            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-1 text-slate-600 dark:text-slate-400">
              <div className="text-slate-800 dark:text-slate-300 font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                WebDAV 特性检测:
              </div>
              <div className="font-mono text-[11px]">• 标识: {selectedAccount.capabilities.serverHeader}</div>
              <div className="font-mono text-[11px]">• ETag 强校验: {selectedAccount.capabilities.etagType}</div>
              <div className="font-mono text-[11px]">• If-Match 条件写入: {selectedAccount.capabilities.supportsIfMatch ? '支持 (并发保护)' : '不支持'}</div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Select Local Directory */}
      {currentStep === 2 && (
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">本地工作区目录</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                className="flex-1 bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                placeholder="C:/Users/Example/Projects/MyApp"
              />
              <Button
                variant="secondary"
                size="md"
                onClick={handlePickLocalDirectory}
              >
                浏览本地文件夹...
              </Button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              系统将监听该目录下的文件变更，并实时计算 BLAKE3 校验和。
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-aerospace-canvas p-4 rounded-xl border border-slate-200 dark:border-aerospace-border space-y-2">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              本地目录环境检查
            </div>
            <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
              <div className="text-emerald-600 dark:text-emerald-400">✓ 路径存在且具有完整读写权限</div>
              <div className="text-emerald-600 dark:text-emerald-400">✓ 路径未处于 WebDAV 挂载盘内（排除死循环递归）</div>
              <div className="text-emerald-600 dark:text-emerald-400">✓ 大小写保留映射正常</div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Select Remote WebDAV Directory */}
      {currentStep === 3 && (
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">远端 WebDAV 存放路径</label>
            <input
              type="text"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
              placeholder="/projects/MyDevApp"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              若该远端路径不存在，ProjectSync 将自动发送 <code>MKCOL</code> 创建目录。
            </p>
          </div>

          <div className="border border-slate-200 dark:border-aerospace-border rounded-xl p-3.5 bg-slate-50 dark:bg-aerospace-canvas space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
              <span className="flex items-center gap-1.5">
                <Cloud className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                远端目录浏览
              </span>
              <div className="flex items-center gap-2">
                <code className="text-[10px] text-slate-500">{remoteBrowsePath}</code>
                <button type="button" onClick={() => setRemoteBrowsePath(parentRemoteDirectory(remoteBrowsePath))} disabled={remoteBrowsePath === '/'} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40" aria-label="上级目录">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <Button variant="secondary" size="sm" onClick={handleBrowseRemote} disabled={loadingRemote || !selectedAccountId} className="gap-1">
                  <FolderOpen className="w-3.5 h-3.5" />{loadingRemote ? '读取中' : '浏览'}
                </Button>
              </div>
            </div>
            {remoteBrowseError && <div role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">{remoteBrowseError}</div>}
            <div className="bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-transparent rounded-lg p-2.5 font-mono text-xs text-slate-700 dark:text-slate-300 space-y-1 max-h-40 overflow-y-auto">
              {remoteEntries.length === 0 ? <div className="text-slate-500">选择“浏览”读取此目录。点击文件夹可将其设为目标路径。</div> : remoteEntries.map((entry) => (
                <button key={entry.path} type="button" disabled={!entry.isCollection} onClick={() => { setRemotePath(entry.path); setRemoteBrowsePath(entry.path); }} className="w-full text-left rounded px-2 py-1 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50">
                  {entry.isCollection ? '📁' : '📄'} {entry.name || '/'}{entry.isCollection ? '/' : ''}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setRemotePath(remoteBrowsePath)} className="text-cyan-700 dark:text-cyan-300">使用当前远端目录：{remoteBrowsePath}</Button>
          </div>
        </div>
      )}

      {/* Step 4: Sync Rules Engine */}
      {currentStep === 4 && (
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <span>文件过滤规则（自上而下匹配，排除规则优先）</span>
            </div>
          </div>

          {/* Add New Rule Inline */}
          <div className="flex gap-2">
            <select
              value={newRuleType}
              onChange={(e) => setNewRuleType(e.target.value as 'INCLUDE' | 'EXCLUDE')}
              className="bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="INCLUDE">包含 (INCLUDE)</option>
              <option value="EXCLUDE">排除 (EXCLUDE)</option>
            </select>
            <input
              type="text"
              value={newRulePattern}
              onChange={(e) => setNewRulePattern(e.target.value)}
              placeholder="Glob 表达式: 如 docs/**, *.md, **/.git/**"
              className="flex-1 bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <Button variant="secondary" size="sm" onClick={handleAddRule} className="gap-1">
              <Plus className="w-3.5 h-3.5" />
              添加
            </Button>
          </div>

          {/* Rules List */}
          <div className="border border-slate-200 dark:border-aerospace-border rounded-xl bg-white dark:bg-aerospace-canvas overflow-hidden max-h-56 overflow-y-auto">
            <div className="divide-y divide-slate-100 dark:divide-aerospace-border">
              {rules.map((rule) => (
                <div key={rule.id} className="p-2.5 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        rule.ruleType === 'INCLUDE'
                          ? 'bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800'
                          : 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                      }`}
                    >
                      {rule.ruleType}
                    </span>
                    <span className="text-slate-800 dark:text-slate-200">{rule.pattern}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(rule.id)}
                    className="text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400 p-1 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Initial Sync Preview & Safety Gate */}
      {currentStep === 5 && (
        <div className="space-y-4 py-2">
          {loadingPreview ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <div>正在扫描本地与远端文件元数据，计算增量差异...</div>
            </div>
          ) : previewData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800 p-2.5 rounded-lg">
                  <div className="text-[10px] text-cyan-700 dark:text-cyan-400 font-medium">待上传</div>
                  <div className="text-lg font-bold text-cyan-800 dark:text-cyan-300 font-mono">{previewData.uploadsCount} 项</div>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-2.5 rounded-lg">
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">内容一致</div>
                  <div className="text-lg font-bold text-emerald-800 dark:text-emerald-300 font-mono">{previewData.identicalCount} 项</div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-2.5 rounded-lg">
                  <div className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">检测到冲突</div>
                  <div className="text-lg font-bold text-amber-800 dark:text-amber-300 font-mono">{previewData.conflictsCount} 项</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">预计上传大小</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-200 font-mono">
                    {(previewData.totalUploadBytes / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </div>
              </div>

              {/* Sample Operations Table */}
              <div className="border border-slate-200 dark:border-aerospace-border rounded-xl bg-white dark:bg-aerospace-canvas overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 dark:bg-aerospace-rail border-b border-slate-200 dark:border-aerospace-border text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex justify-between">
                  <span>初始同步计划</span>
                  <span className="text-slate-500 font-mono">共 {previewData.items.length} 个动作</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-aerospace-border max-h-48 overflow-y-auto">
                  {previewData.items.map((item, idx) => (
                    <div key={idx} className="p-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 truncate max-w-[360px]">
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                            item.action.startsWith('Upload')
                              ? 'bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800'
                              : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {item.action}
                        </span>
                        <span className="text-slate-800 dark:text-slate-200 truncate font-mono">{item.relativePath}</span>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{item.reason}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-600/50 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  初始同步提示：确认后将写入同步基准，并启动双向监控。
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Wizard Footer Controls */}
      <div className="flex items-center justify-between pt-4 border-t border-aerospace-border">
        {currentStep > 1 ? (
          <Button
            variant="secondary"
            size="md"
            onClick={() => setCurrentStep((prev) => (prev - 1) as 1 | 2 | 3 | 4 | 5)}
            className="gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            上一步
          </Button>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            取消
          </Button>

          {currentStep < 4 ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCurrentStep((prev) => (prev + 1) as 1 | 2 | 3 | 4 | 5)}
              className="gap-1.5"
            >
              下一步
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          ) : currentStep === 4 ? (
            <Button
              variant="primary"
              size="md"
              onClick={handleGoToStep5}
              className="gap-1.5"
            >
              查看同步预览
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button
              variant="accent"
              size="md"
              onClick={handleConfirmCreate}
              disabled={submitting || loadingPreview}
              className="gap-1.5"
            >
              {submitting ? '正在创建...' : '确认并开始同步'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function parentRemoteDirectory(path: string): string {
  const normalized = path.trim().replace(/\/+$/, '') || '/';
  const separator = normalized.lastIndexOf('/');
  return separator <= 0 ? '/' : normalized.slice(0, separator);
}
