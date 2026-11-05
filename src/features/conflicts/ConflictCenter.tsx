import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  HardDrive,
  Cloud,
  FileCheck2,
  Copy,
  CheckCircle,
  Bot,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';
import { AiMergePreviewDto, AiSettingsDto, ConflictItemDto, ConflictResolution } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';

interface ConflictCenterProps {
  conflicts: ConflictItemDto[];
  onResolve: (conflictId: string, resolution: ConflictResolution) => Promise<void>;
  onPreviewAiMerge: (conflictId: string) => Promise<AiMergePreviewDto>;
  onApplyAiMerge: (conflictId: string, previewId: string) => Promise<void>;
  onOpenAiSettings: () => void;
}

export function ConflictCenter({
  conflicts,
  onResolve,
  onPreviewAiMerge,
  onApplyAiMerge,
  onOpenAiSettings,
}: ConflictCenterProps) {
  const unresolvedConflicts = conflicts.filter((c) => c.status === 'UNRESOLVED');
  const [selectedId, setSelectedId] = useState<string | null>(
    unresolvedConflicts.length > 0 ? unresolvedConflicts[0].id : null
  );
  const [confirmResolution, setConfirmResolution] = useState<{
    id: string;
    resolution: ConflictResolution;
    title: string;
    description: string;
  } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettingsDto | null>(null);
  const [aiPreview, setAiPreview] = useState<AiMergePreviewDto | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  const activeConflict = conflicts.find((c) => c.id === selectedId) || unresolvedConflicts[0];

  useEffect(() => {
    let active = true;
    api.getAiSettings()
      .then((value) => { if (active) setAiSettings(value); })
      .catch(() => { if (active) setAiSettings(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setAiPreview(null);
    setAiError('');
  }, [selectedId]);

  const handleAiMergePreview = async () => {
    if (!activeConflict) return;
    setAiBusy(true);
    setAiError('');
    try {
      setAiPreview(await onPreviewAiMerge(activeConflict.id));
    } catch (reason: unknown) {
      setAiError(errorMessage(reason));
    } finally {
      setAiBusy(false);
    }
  };

  const handleAiMergeApply = async () => {
    if (!activeConflict || !aiPreview) return;
    setAiBusy(true);
    setAiError('');
    try {
      await onApplyAiMerge(activeConflict.id, aiPreview.previewId);
      setAiPreview(null);
    } catch (reason: unknown) {
      setAiError(errorMessage(reason));
    } finally {
      setAiBusy(false);
    }
  };

  const handleApplyResolution = async () => {
    if (!confirmResolution) return;
    setProcessing(true);
    try {
      await onResolve(confirmResolution.id, confirmResolution.resolution);
      setConfirmResolution(null);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-soft-sm flex items-start justify-between transition-colors">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>文件冲突拦截与版本裁决</span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-medium">
                安全拦截已生效
              </span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
              安全保护机制：系统<strong>严禁静默覆盖不同内容的文件</strong>。当本地与远程 WebDAV 发生并发修改或存在内容分歧时，写操作将被挂起，需手动选择处理方案。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
          <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span>待处理冲突: <strong className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">{unresolvedConflicts.length}</strong></span>
        </div>
      </div>

      {unresolvedConflicts.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center space-y-3 shadow-soft-sm transition-colors">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">当前没有未决冲突</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            本地工作目录与 WebDAV 远端文件完全一致，暂无冲突。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Conflict List (4 Cols) */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-soft-sm transition-colors">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">冲突文件列表</span>
              <span className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/80 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800 font-medium">
                <span className="font-mono">{unresolvedConflicts.length}</span> 个文件
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
              {unresolvedConflicts.map((item) => {
                const isSelected = item.id === (activeConflict?.id || selectedId);
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`p-3.5 cursor-pointer transition-colors space-y-1.5 ${
                      isSelected
                        ? 'bg-amber-50/80 dark:bg-amber-950/40 text-slate-900 dark:text-slate-100 ring-1 ring-amber-400/50 dark:ring-amber-500/50'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-medium truncate max-w-[200px]" title={item.relativePath}>
                        {item.relativePath}
                      </span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 shrink-0">
                        {item.conflictType}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                      <span>{new Date(item.detectedAt).toLocaleTimeString()}</span>
                      <span>{(item.localVersion.sizeBytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right 3-Way Comparison Inspector (8 Cols) */}
          {activeConflict && (
            <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-soft-sm space-y-5 transition-colors">
              {/* Target File Info */}
              <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono truncate">
                      {activeConflict.relativePath}
                    </h3>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      项目 ID: {activeConflict.rootId}
                    </span>
                  </div>
                  <div className="text-xs text-amber-700 dark:text-amber-400 font-mono flex items-center gap-2">
                    <span>分歧类型: {activeConflict.conflictType}</span>
                    <span>•</span>
                    <span>拦截时间: {new Date(activeConflict.detectedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Three-Way Comparison Grid: Local Version vs WebDAV Remote Version */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Local Version Box */}
                <div className="bg-slate-50 dark:bg-slate-800/40 border border-indigo-200 dark:border-indigo-800/80 rounded-xl p-4 space-y-3 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
                      <HardDrive className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span>本地版本</span>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-md font-medium">
                      本机修改
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-1">
                      <span className="text-slate-500 dark:text-slate-400">修改设备:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">{activeConflict.localVersion.authorDevice}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-1">
                      <span className="text-slate-500 dark:text-slate-400">文件大小:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">{activeConflict.localVersion.sizeBytes} 字节</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-1">
                      <span className="text-slate-500 dark:text-slate-400">修改时间:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">
                        {new Date(activeConflict.localVersion.modifiedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="space-y-1 pt-1">
                      <span className="text-slate-500 dark:text-slate-400 text-[11px]">BLAKE3 内容哈希:</span>
                      <code className="block bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-indigo-700 dark:text-indigo-300 truncate select-all">
                        {activeConflict.localVersion.blake3Hash}
                      </code>
                    </div>
                  </div>
                </div>

                {/* Remote WebDAV Version Box */}
                <div className="bg-slate-50 dark:bg-slate-800/40 border border-amber-200 dark:border-amber-800/80 rounded-xl p-4 space-y-3 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-xs font-semibold">
                      <Cloud className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>远端版本 (WebDAV)</span>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-md font-medium">
                      云端节点
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-1">
                      <span className="text-slate-500 dark:text-slate-400">存储服务:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">hacdias/webdav</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-1">
                      <span className="text-slate-500 dark:text-slate-400">文件大小:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">{activeConflict.remoteVersion.sizeBytes} 字节</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-1">
                      <span className="text-slate-500 dark:text-slate-400">修改时间:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">
                        {new Date(activeConflict.remoteVersion.modifiedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="space-y-1 pt-1">
                      <span className="text-slate-500 dark:text-slate-400 text-[11px]">HTTP ETag 强标识:</span>
                      <code className="block bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-amber-800 dark:text-amber-300 truncate select-all">
                        {activeConflict.remoteVersion.etag}
                      </code>
                    </div>
                  </div>
                </div>
              </div>

              {/* Baseline Info if present */}
              {activeConflict.baseVersion && (
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <FileCheck2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    共同基准版本: <span className="font-mono text-slate-800 dark:text-slate-200">{activeConflict.baseVersion.sizeBytes} 字节</span> (
                    <span className="font-mono">{new Date(activeConflict.baseVersion.modifiedAt).toLocaleTimeString()}</span>)
                  </span>
                  <code className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate max-w-[240px]">
                    {activeConflict.baseVersion.blake3Hash}
                  </code>
                </div>
              )}

              {/* Triage Decision Actions */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                  <span>冲突处理方案</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                    请选择满意的保留规则，确认后立即生效
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {/* Action 1: KEEP_BOTH (Default Recommended) */}
                  <div
                    onClick={() =>
                      setConfirmResolution({
                        id: activeConflict.id,
                        resolution: 'KeepBoth',
                        title: '确认保留双端版本（推荐）',
                        description: `系统将保留两端内容：下载远端文件并自动重命名为 ${activeConflict.relativePath}.conflict-${new Date().toISOString().slice(0, 10)}.md，本地现有文件原样保留，不会丢失任何数据。`,
                      })
                    }
                    className="p-3.5 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50/70 dark:bg-indigo-950/30 hover:bg-indigo-100/70 dark:hover:bg-indigo-950/50 cursor-pointer transition-all space-y-1.5 shadow-soft-sm"
                  >
                    <div className="text-xs font-semibold text-indigo-800 dark:text-indigo-300 flex items-center gap-1.5">
                      <Copy className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span>保留双端版本 (推荐)</span>
                    </div>
                    <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-normal">
                      推荐首选。为远端内容创建独立冲突副本，本地修改原样保留，确保两端数据均不丢失。
                    </p>
                  </div>

                  {/* Action: AI text merge */}
                  <div
                    className={`p-3.5 rounded-xl border space-y-1.5 shadow-soft-sm transition-all ${
                      aiSettings?.configured
                        ? 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/70 cursor-pointer dark:border-amber-700 dark:bg-amber-950/20 dark:hover:bg-amber-950/40'
                        : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60'
                    }`}
                    onClick={() => {
                      if (!aiSettings?.configured) {
                        onOpenAiSettings();
                        return;
                      }
                      void handleAiMergePreview();
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <span>{aiSettings?.configured ? 'AI 智能合并' : '配置 AI 合并'}</span>
                      </span>
                      {aiBusy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    </div>
                    <p className="text-[11px] leading-normal text-slate-600 dark:text-slate-400">
                      {aiSettings?.configured
                        ? '将双方 UTF-8 文本发送给已配置模型，生成完整合并结果供你审阅；原始版本自动备份。'
                        : '需要先在 AI 设置中保存接口和模型。'}
                    </p>
                  </div>

                  {/* Action 2: KEEP_LOCAL */}
                  <div
                    onClick={() =>
                      setConfirmResolution({
                        id: activeConflict.id,
                        resolution: 'KeepLocal',
                        title: '确认以本地版本为准（覆盖远端）',
                        description: `本地版本将上传并覆盖 WebDAV 远端的对应文件。写入前会重新核对远端版本，并使用服务端已验证的 If-Match 或独占锁保护；发现变化时会停止覆盖。`,
                      })
                    }
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all space-y-1.5 shadow-soft-sm"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      <span>以本地为准 (覆盖远端)</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-normal">
                      以本地修改为准，上传覆盖 WebDAV 远端内容。写入前核对远端版本，由条件写入或独占锁保护。
                    </p>
                  </div>

                  {/* Action 3: KEEP_REMOTE */}
                  <div
                    onClick={() =>
                      setConfirmResolution({
                        id: activeConflict.id,
                        resolution: 'KeepRemote',
                        title: '确认以远端版本为准（覆盖本地）',
                        description: `远端版本将下载并替换本地文件。为保证安全，本地现有文件将被备份至回收站 (.projectsync/trash)，可随时找回。`,
                      })
                    }
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all space-y-1.5 shadow-soft-sm"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Cloud className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      <span>以远端为准 (覆盖本地)</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-normal">
                      下载远端文件覆盖本地。本地当前文件会自动移入备份回收站 (.projectsync/trash)。
                    </p>
                  </div>
                </div>
                {aiError && (
                  <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words">{aiError}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Conflict Action */}
      {confirmResolution && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-soft-lg w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{confirmResolution.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">请核对本次操作的影响范围</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 leading-relaxed">
              {confirmResolution.description}
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setConfirmResolution(null)}
                disabled={processing}
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleApplyResolution}
                disabled={processing}
              >
                {processing ? '正在处理...' : '确认解决'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {aiPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm dark:bg-black/80">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft-lg dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">审阅 AI 合并结果</h3>
                  <p className="mt-0.5 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{aiPreview.relativePath}</p>
                </div>
              </div>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {aiPreview.model}
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>确认后会同时替换本地和 WebDAV 文件。原始本地与远端版本已分别备份到 ProjectSync 回收站；请先完整审阅以下内容。</span>
            </div>

            <textarea
              readOnly
              aria-label="AI 合并结果预览"
              value={aiPreview.mergedContent}
              className="min-h-64 flex-1 resize-none overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200"
            />

            {aiError && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                {aiError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                本地 {formatBytes(aiPreview.localSize)} · 远端 {formatBytes(aiPreview.remoteSize)}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="md" onClick={() => setAiPreview(null)} disabled={aiBusy}>
                  取消
                </Button>
                <Button variant="accent" size="md" onClick={handleAiMergeApply} disabled={aiBusy} className="gap-1.5">
                  {aiBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                  {aiBusy ? '正在写入…' : '确认写入两端'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function errorMessage(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    return String(reason.message);
  }
  return String(reason);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KiB`;
}
