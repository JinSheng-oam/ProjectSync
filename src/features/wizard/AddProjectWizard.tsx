import { useEffect, useState } from 'react';
import {
  Server,
  Cloud,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  HardDrive,
  FolderOpen,
  ArrowUp,
  ShieldCheck,
  LoaderCircle,
} from 'lucide-react';
import { WebDavAccountDto, SyncRuleDto, InitialSyncPreviewDto, DiscoveredProject } from '../../types/dto';
import { Button, Modal } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { RuleEditor, recommendedRules } from '../rules/RuleEditor';

interface AddProjectWizardProps {
  isOpen: boolean;
  remoteProject: DiscoveredProject | null;
  onClose: () => void;
  accounts: WebDavAccountDto[];
  onProjectCreated: () => void;
}

export function AddProjectWizard({
  isOpen,
  remoteProject,
  onClose,
  accounts,
  onProjectCreated,
}: AddProjectWizardProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Form State
  const defaultLocalPath = 'D:/Projects/MyDevApp';
  const [projectName, setProjectName] = useState(() => localDirectoryName(defaultLocalPath));
  const [projectNameCustomized, setProjectNameCustomized] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || '');
  const [localPath, setLocalPath] = useState(defaultLocalPath);
  const [remotePath, setRemotePath] = useState(() => defaultRemotePath(defaultLocalPath));
  const [remotePathCustomized, setRemotePathCustomized] = useState(false);
  const [remoteBrowsePath, setRemoteBrowsePath] = useState('/');
  const [remoteEntries, setRemoteEntries] = useState<Awaited<ReturnType<typeof api.browseRemoteDirectory>>>([]);
  const [remoteBrowseLoaded, setRemoteBrowseLoaded] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteBrowseError, setRemoteBrowseError] = useState<string | null>(null);
  const [remoteBrowseRefresh, setRemoteBrowseRefresh] = useState(0);

  const [rules, setRules] = useState<SyncRuleDto[]>(recommendedRules);
  const [excludeGitTracked, setExcludeGitTracked] = useState(false);

  // Step 5 Preview State
  const [previewData, setPreviewData] = useState<InitialSyncPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSelectedAccountId((currentId) =>
      accounts.some((account) => account.id === currentId) ? currentId : accounts[0]?.id || ''
    );
  }, [accounts]);

  useEffect(() => {
    if (!isOpen || !remoteProject) return;
    setCurrentStep(2);
    setSelectedAccountId(remoteProject.accountId);
    setProjectName(remoteProject.name);
    setProjectNameCustomized(true);
    setLocalPath('');
    setRemotePath(remoteProject.remotePath);
    setRemotePathCustomized(true);
  }, [isOpen, remoteProject]);

  useEffect(() => {
    if (isOpen) setExcludeGitTracked(false);
  }, [isOpen, remoteProject]);

  // Load preview when entering Step 5
  const handleGoToStep5 = async () => {
    setPreviewData(null);
    setPreviewError(null);
    setLoadingPreview(true);
    setCurrentStep(5);
    try {
      const data = await api.previewInitialSync(
        selectedAccountId,
        localPath,
        remotePath,
        rules,
        excludeGitTracked,
      );
      setPreviewData(data);
    } catch (err: unknown) {
      console.error(err);
      setPreviewError(getErrorMessage(err));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleLocalPathChange = (path: string) => {
    setLocalPath(path);
    if (!projectNameCustomized) setProjectName(localDirectoryName(path));
    if (!remotePathCustomized) setRemotePath(defaultRemotePath(path));
  };

  const handlePickLocalDirectory = async () => {
    try {
      const selected = await api.pickLocalDirectory();
      if (selected) handleLocalPathChange(selected.replace(/\\/g, '/'));
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : '选择本地目录失败');
    }
  };

  useEffect(() => {
    if (!isOpen || currentStep !== 3 || !selectedAccountId) return;
    let cancelled = false;
    setLoadingRemote(true);
    setRemoteBrowseError(null);
    setRemoteBrowseLoaded(false);
    setRemoteEntries([]);
    api.browseRemoteDirectory(selectedAccountId, remoteBrowsePath).then((entries) => {
      if (!cancelled) { setRemoteEntries(entries); setRemoteBrowseLoaded(true); }
    }).catch((error: unknown) => {
      if (!cancelled) setRemoteBrowseError(getErrorCode(error) === 'DAV_NOT_FOUND' ? '该目录不存在，请返回上级目录。' : getErrorMessage(error));
    }).finally(() => { if (!cancelled) setLoadingRemote(false); });
    return () => { cancelled = true; };
  }, [isOpen, currentStep, selectedAccountId, remoteBrowsePath, remoteBrowseRefresh]);

  const handleConfirmCreate = async () => {
    setCreateError(null);
    setSubmitting(true);
    try {
      await api.createSyncRoot({
        name: projectName,
        accountId: selectedAccountId,
        localPath,
        remotePath,
        rules,
        excludeGitTracked,
      });
      onProjectCreated();
      onClose();
    } catch (err: unknown) {
      setCreateError(getErrorMessage(err));
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
      headerExtra={
        <div className="flex items-center justify-between">
          {[
            { step: 1, title: 'WebDAV 节点' },
            { step: 2, title: '项目名称与目录' },
            { step: 3, title: '远端路径' },
            { step: 4, title: '同步规则' },
            { step: 5, title: '初始预览' },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-semibold transition-colors ${
                  currentStep === item.step
                    ? 'bg-indigo-600 text-white shadow-soft-sm ring-2 ring-indigo-500/20'
                    : currentStep > item.step
                    ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}
              >
                {currentStep > item.step ? '✓' : item.step}
              </span>
              <span
                className={`text-xs transition-colors ${
                  currentStep === item.step
                    ? 'text-indigo-700 dark:text-indigo-300 font-semibold'
                    : currentStep > item.step
                    ? 'text-slate-700 dark:text-slate-300 font-medium'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {item.title}
              </span>
            </div>
          ))}
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full">
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
                disabled={currentStep === 1 && !selectedAccountId}
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
                onClick={previewData ? handleConfirmCreate : handleGoToStep5}
                disabled={submitting || loadingPreview || (!previewData && !selectedAccountId)}
                className="gap-1.5"
              >
                {submitting && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                {submitting ? '正在创建...' : previewData ? '确认并开始同步' : '重新生成预览'}
              </Button>
            )}
          </div>
        </div>
      }
    >

      {/* Step 1: Select WebDAV Account */}
      {currentStep === 1 && (
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">选择 WebDAV 远端连接</label>
            <div className="grid grid-cols-1 gap-2.5">
              {accounts.length === 0 ? (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  尚未配置 WebDAV 节点。请先取消向导，在“WebDAV 节点”页面添加连接。
                </div>
              ) : accounts.map((acc) => (
                <div
                  key={acc.id}
                  onClick={() => { if (selectedAccountId !== acc.id) setRemoteBrowsePath('/'); setSelectedAccountId(acc.id); }}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-colors flex items-center justify-between ${
                    selectedAccountId === acc.id
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-500 text-slate-900 dark:text-slate-100 shadow-soft-sm'
                      : 'bg-white dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <div>
                      <div className="font-semibold text-xs">{acc.name}</div>
                      <code className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{acc.url}</code>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      探测通过
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedAccount?.capabilities && (
            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1 text-slate-600 dark:text-slate-400">
              <div className="text-slate-900 dark:text-slate-100 font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                WebDAV 特性检测:
              </div>
              <div className="font-mono text-[11px]">• 标识: {selectedAccount.capabilities.serverHeader}</div>
              <div className="font-mono text-[11px]">• ETag 强校验: {selectedAccount.capabilities.etagType}</div>
              <div className="font-mono text-[11px]">• If-Match 条件写入: {selectedAccount.capabilities.supportsIfMatch ? '支持 (并发保护)' : '不支持'}</div>
              <div className="font-mono text-[11px]">• WebDAV 独占锁写保护: {selectedAccount.capabilities.supportsLock ? '已验证' : '未验证'}</div>
              <div className="font-mono text-[11px]">• 安全新建: {selectedAccount.capabilities.safeCreateOnly ? (selectedAccount.capabilities.supportsIfNoneMatch ? 'If-None-Match' : '独占锁') : '未验证'}</div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Select Local Directory */}
      {currentStep === 2 && (
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-[0.85fr_1.4fr] gap-4 items-start">
            <div className="space-y-1.5">
              <label htmlFor="project-name" className="text-xs font-medium text-slate-700 dark:text-slate-300">项目名称</label>
              <input
                id="project-name"
                type="text"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  setProjectNameCustomized(true);
                }}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 font-medium"
                placeholder="输入项目名称"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">默认使用目录名，可手动修改。</p>
            </div>

            <div className="space-y-1.5 min-w-0">
              <label htmlFor="local-project-directory" className="text-xs font-medium text-slate-700 dark:text-slate-300">本地工作区目录</label>
              <div className="flex gap-2 min-w-0">
                <input
                  id="local-project-directory"
                  type="text"
                  value={localPath}
                  onChange={(e) => handleLocalPathChange(e.target.value)}
                  className="min-w-0 flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                  placeholder="C:/Users/Example/Projects/MyApp"
                />
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handlePickLocalDirectory}
                  className="shrink-0"
                >
                  浏览文件夹
                </Button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                监听该目录的文件变更，并实时计算 BLAKE3 校验和。
              </p>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              本地目录环境检查
            </div>
            <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
              <div className="text-emerald-700 dark:text-emerald-300">✓ 路径存在且具有完整读写权限</div>
              <div className="text-emerald-700 dark:text-emerald-300">✓ 路径未处于 WebDAV 挂载盘内（排除死循环递归）</div>
              <div className="text-emerald-700 dark:text-emerald-300">✓ 大小写保留映射正常</div>
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
              onChange={(e) => {
                setRemotePath(e.target.value);
                setRemotePathCustomized(true);
              }}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
              placeholder="/projects/MyDevApp"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              若该远端路径不存在，ProjectSync 将自动发送 <code>MKCOL</code> 创建目录。
            </p>
          </div>

          <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 bg-slate-50 dark:bg-slate-800/50 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-slate-100">
              <span className="flex items-center gap-1.5">
                <Cloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                远端目录浏览
              </span>
              <div className="flex items-center gap-2">
                <code className="text-[11px] text-slate-600 dark:text-slate-400">{remoteBrowsePath}</code>
                <button type="button" onClick={() => setRemoteBrowsePath(parentRemoteDirectory(remoteBrowsePath))} disabled={remoteBrowsePath === '/'} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40" aria-label="上级目录">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <Button variant="secondary" size="sm" onClick={() => setRemoteBrowseRefresh((value) => value + 1)} disabled={loadingRemote || !selectedAccountId} className="gap-1">
                  <FolderOpen className="w-3.5 h-3.5" />{loadingRemote ? '读取中' : '刷新'}
                </Button>
              </div>
            </div>
            {!selectedAccountId && (
              <div role="alert" className="text-[11px] text-amber-700 dark:text-amber-400">
                尚未选择 WebDAV 节点，请返回第 1 步选择连接后再浏览。
              </div>
            )}
            {remoteBrowseError && <div role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">{remoteBrowseError}</div>}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 font-mono text-xs text-slate-700 dark:text-slate-300 space-y-1 max-h-40 overflow-y-auto">
              {remoteEntries.length === 0 ? <div className="text-slate-500">{loadingRemote ? '正在读取远端目录…' : remoteBrowseLoaded ? '此目录为空。' : remoteBrowseError ? '无法读取目录。' : '正在准备读取远端目录。'}</div> : remoteEntries.map((entry) => (
                <button key={entry.path} type="button" disabled={!entry.isCollection} onClick={() => setRemoteBrowsePath(entry.path)} className="w-full text-left rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
                  {entry.isCollection ? '📁' : '📄'} {entry.name || '/'}{entry.isCollection ? '/' : ''}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" disabled={!remoteBrowseLoaded || loadingRemote} onClick={() => { setRemotePath(remoteBrowsePath); setRemotePathCustomized(true); }} className="text-indigo-700 dark:text-indigo-300">使用当前远端目录：{remoteBrowsePath}</Button>
          </div>
        </div>
      )}

      {currentStep === 4 && (
        <div className="py-2 space-y-4">
          <RuleEditor rules={rules} onChange={setRules} localPath={localPath} />
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeGitTracked}
              onChange={(event) => setExcludeGitTracked(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span className="space-y-1">
              <span className="block text-xs font-medium text-slate-800 dark:text-slate-100">
                排除 Git 已跟踪文件
              </span>
              <span className="block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                启用后跳过 Git 索引中已跟踪的文件，不上传或下载，也不会删除两端已有文件；未跟踪文件仍按上方规则同步。Git 仓库建议开启；需要本机安装 Git。
              </span>
            </span>
          </label>
        </div>
      )}

      {/* Step 5: Initial Sync Preview & Safety Gate */}
      {currentStep === 5 && (
        <div className="space-y-4 py-2">
          {loadingPreview ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <div>正在扫描本地与远端文件元数据，计算增量差异...</div>
            </div>
          ) : previewData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 p-2.5 rounded-xl">
                  <div className="text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">待上传</div>
                  <div className="text-lg font-bold text-indigo-900 dark:text-indigo-200 font-mono tabular-nums">{previewData.uploadsCount} 项</div>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-2.5 rounded-xl">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">内容一致</div>
                  <div className="text-lg font-bold text-emerald-900 dark:text-emerald-200 font-mono tabular-nums">{previewData.identicalCount} 项</div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-2.5 rounded-xl">
                  <div className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">检测到冲突</div>
                  <div className="text-lg font-bold text-amber-900 dark:text-amber-200 font-mono tabular-nums">{previewData.conflictsCount} 项</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">预计上传大小</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                    {(previewData.totalUploadBytes / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </div>
              </div>

              {/* Sample Operations Table */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex justify-between">
                  <span>初始同步计划</span>
                  <span className="text-slate-500 font-mono">共 {previewData.items.length} 个动作</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-48 overflow-y-auto">
                  {previewData.items.map((item, idx) => (
                    <div key={idx} className="p-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 truncate max-w-[360px]">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
                            item.action.startsWith('Upload')
                              ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                              : 'bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {item.action}
                        </span>
                        <span className="text-slate-900 dark:text-slate-100 truncate font-mono">{item.relativePath}</span>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{item.reason}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700/60 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  初始同步提示：确认后将写入同步基准，并启动双向监控。
                </span>
              </div>
              {createError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                  创建同步项目失败：{createError}
                </div>
              )}
              {submitting && (
                <div role="status" aria-live="polite" className="text-xs text-slate-600 dark:text-slate-300">
                  正在初始化远端目录并保存项目；完成后会返回看板，首次扫描将在后台执行。
                </div>
              )}
            </div>
          ) : previewError ? (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-semibold">无法生成初始同步预览</div>
                <div className="break-words">{previewError}</div>
                <div className="text-rose-700/80 dark:text-rose-300/80">请检查本地目录、远端路径和 WebDAV 连接后重试。</div>
              </div>
            </div>
          ) : (
            <div role="status" className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              尚未生成预览，请返回上一步后重新查看。
            </div>
          )}
        </div>
      )}

    </Modal>
  );
}

function parentRemoteDirectory(path: string): string {
  const normalized = path.trim().replace(/\/+$/, '') || '/';
  const separator = normalized.lastIndexOf('/');
  return separator <= 0 ? '/' : normalized.slice(0, separator);
}

function defaultRemotePath(localPath: string): string {
  return `/projects/${localDirectoryName(localPath)}`;
}

function localDirectoryName(localPath: string): string {
  const normalized = localPath.trim().replace(/[\\/]+$/, '');
  const directoryName = normalized.split(/[\\/]/).pop();
  return directoryName && !/^[a-z]:$/i.test(directoryName) ? directoryName : 'Project';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '发生未知错误。';
}

function getErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}
