import { useEffect, useState } from 'react';
import { Server, ArrowRight, ArrowLeft, HardDrive, ShieldCheck, LoaderCircle } from 'lucide-react';
import { WebDavAccountDto, SyncRuleDto, InitialSyncPreviewDto, DiscoveredProject } from '../../types/dto';
import { Button, Modal } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { RuleEditor, recommendedRules } from '../rules/RuleEditor';

import { RemoteDirectoryBrowser, useRemoteDirectory } from './RemoteDirectoryBrowser';
import { InitialSyncPreview } from './InitialSyncPreview';
import { getErrorMessage } from './wizardErrors';

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
  const remoteBrowse = useRemoteDirectory(isOpen && currentStep === 3, selectedAccountId);
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
                  onClick={() => { if (selectedAccountId !== acc.id) remoteBrowse.setRemoteBrowsePath('/'); setSelectedAccountId(acc.id); }}
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
              <div className="text-xs">• 标识: <span className="font-mono">{selectedAccount.capabilities.serverHeader}</span></div>
              <div className="text-xs">• ETag 强校验: <span className="font-mono">{selectedAccount.capabilities.etagType}</span></div>
              <div className="text-xs">• If-Match 条件写入: <span className="font-medium">{selectedAccount.capabilities.supportsIfMatch ? '支持 (并发保护)' : '不支持'}</span></div>
              <div className="text-xs">• WebDAV 独占锁写保护: <span className="font-medium">{selectedAccount.capabilities.supportsLock ? '已验证' : '未验证'}</span></div>
              <div className="text-xs">• 安全新建: <span className="font-mono">{selectedAccount.capabilities.safeCreateOnly ? (selectedAccount.capabilities.supportsIfNoneMatch ? 'If-None-Match' : '独占锁') : '未验证'}</span></div>
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
              目录不存在时将自动创建。
            </p>
          </div>

          <RemoteDirectoryBrowser browse={remoteBrowse} selectedAccountId={selectedAccountId} onSelect={(path) => { setRemotePath(path); setRemotePathCustomized(true); }} />
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
                仅限本机，需安装 Git。
              </span>
            </span>
          </label>
        </div>
      )}

      {/* Step 5: Initial Sync Preview & Safety Gate */}
      {currentStep === 5 && <InitialSyncPreview {...{ loadingPreview, previewData, previewError, createError, submitting }} />}

    </Modal>
  );
}

function defaultRemotePath(localPath: string): string {
  return `/projects/${localDirectoryName(localPath)}`;
}

function localDirectoryName(localPath: string): string {
  const normalized = localPath.trim().replace(/[\\/]+$/, '');
  const directoryName = normalized.split(/[\\/]/).pop();
  return directoryName && !/^[a-z]:$/i.test(directoryName) ? directoryName : 'Project';
}
