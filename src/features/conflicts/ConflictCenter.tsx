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
  Send,
  User,
  Check,
  RotateCcw,
  Minimize2,
} from 'lucide-react';
import { AiSettingsDto, ConflictItemDto, ConflictResolution } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { AiMergeSession } from '../../stores/syncStore';

interface ConflictCenterProps {
  conflicts: ConflictItemDto[];
  onResolve: (conflictId: string, resolution: ConflictResolution) => Promise<void>;
  aiSession?: AiMergeSession | null;
  onStartAiMerge: (conflict: ConflictItemDto) => Promise<void>;
  onRefineAiMerge: (instruction: string, currentContent?: string) => Promise<void>;
  onApplyAiMerge: (finalContent?: string) => Promise<void>;
  onCloseAiMergeModal: () => void;
  onOpenAiMergeModal: () => void;
  onCancelAiMerge: () => void;
  onOpenAiSettings: () => void;
}

export function ConflictCenter({
  conflicts,
  onResolve,
  aiSession,
  onStartAiMerge,
  onRefineAiMerge,
  onApplyAiMerge,
  onCloseAiMergeModal,
  onOpenAiMergeModal,
  onCancelAiMerge,
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

  // Local draft content for manual edits in the merge modal
  const [localDraftContent, setLocalDraftContent] = useState('');
  const [agentInstruction, setAgentInstruction] = useState('');

  const activeConflict = conflicts.find((c) => c.id === selectedId) || unresolvedConflicts[0];

  useEffect(() => {
    let active = true;
    api.getAiSettings()
      .then((value) => { if (active) setAiSettings(value); })
      .catch(() => { if (active) setAiSettings(null); });
    return () => { active = false; };
  }, []);

  // Sync draft content whenever aiSession preview updates
  useEffect(() => {
    if (aiSession?.preview) {
      setLocalDraftContent(aiSession.preview.mergedContent);
    }
  }, [aiSession?.preview]);

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

  const handleSendAgentInstruction = async () => {
    if (!agentInstruction.trim() || !aiSession) return;
    const instruction = agentInstruction.trim();
    setAgentInstruction('');
    await onRefineAiMerge(instruction, localDraftContent);
  };

  const isAiMergingThis = aiSession && aiSession.conflictId === activeConflict?.id;

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
                const hasSession = aiSession && aiSession.conflictId === item.id;
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
                      <span className="text-xs font-mono font-medium truncate max-w-[180px]" title={item.relativePath}>
                        {item.relativePath}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasSession && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" />
                            {aiSession.status === 'merging' ? '合并中' : 'AI待审'}
                          </span>
                        )}
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                          {item.conflictType}
                        </span>
                      </div>
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

                  {/* Action 2: AI text merge with Agent Refinement */}
                  <div
                    className={`p-3.5 rounded-xl border space-y-1.5 shadow-soft-sm transition-all cursor-pointer ${
                      isAiMergingThis
                        ? 'border-indigo-500 bg-indigo-50/80 dark:border-indigo-500 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20'
                        : aiSettings?.configured
                        ? 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/70 dark:border-amber-700 dark:bg-amber-950/20 dark:hover:bg-amber-950/40'
                        : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60'
                    }`}
                    onClick={() => {
                      if (!aiSettings?.configured) {
                        onOpenAiSettings();
                        return;
                      }
                      if (isAiMergingThis) {
                        onOpenAiMergeModal();
                      } else {
                        void onStartAiMerge(activeConflict);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <span>
                          {isAiMergingThis
                            ? aiSession.status === 'merging'
                              ? 'AI 正在后台合并中…'
                              : '查看 AI 合并审阅面板'
                            : aiSettings?.configured
                            ? 'AI 智能合并与建议'
                            : '配置 AI 合并'}
                        </span>
                      </span>
                      {isAiMergingThis && aiSession.status === 'merging' && (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-amber-600" />
                      )}
                    </div>
                    <p className="text-[11px] leading-normal text-slate-600 dark:text-slate-400">
                      {isAiMergingThis
                        ? '已保留合并状态，点击即可继续与 AI Agent 交互微调并确认写入。'
                        : aiSettings?.configured
                        ? 'AI 给出中文合并建议，支持类 Agent 连续下达指令调整文件；切换页面不受影响。'
                        : '需要先在 AI 设置中保存接口和模型。'}
                    </p>
                  </div>

                  {/* Action 3: KEEP_LOCAL */}
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

                  {/* Action 4: KEEP_REMOTE */}
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

                {aiSession?.error && (
                  <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words">{aiSession.error}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Standard Conflict Action */}
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

      {/* Advanced AI Agent Workspace & Merge Review Modal */}
      {aiSession && aiSession.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm dark:bg-black/80 animate-in fade-in duration-150">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-200 bg-white shadow-soft-lg dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>AI 智能合并与协同审阅</span>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-medium">
                      Agent 交互中
                    </span>
                  </h3>
                  <p className="mt-0.5 break-all font-mono text-xs text-slate-500 dark:text-slate-400">
                    {aiSession.relativePath}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {aiSession.preview?.model && (
                  <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {aiSession.preview.model}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onCloseAiMergeModal}
                  title="最小化并在后台保持"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Split Workspace Body: Left Code Editor (7 cols) + Right Agent Instructions & Chinese Suggestions (5 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 flex-1 min-h-0 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
              {/* Left Column: Editable Merged Content (7 Cols) */}
              <div className="lg:col-span-7 flex flex-col min-h-0 bg-slate-50/40 dark:bg-slate-900/40 relative">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-800/40 text-xs shrink-0">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <span>最终合并代码</span>
                    <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">(可直接手动微调)</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {localDraftContent.length} 字符 · {localDraftContent.split('\n').length} 行
                  </span>
                </div>

                <div className="flex-1 p-3 min-h-0 relative">
                  <textarea
                    aria-label="AI 合并代码预览与编辑"
                    value={localDraftContent}
                    onChange={(e) => setLocalDraftContent(e.target.value)}
                    className="w-full h-full resize-none rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 transition-colors"
                    placeholder={aiSession.status === 'merging' ? 'AI 正在分析并生成合并代码...' : '合并内容为空'}
                  />

                  {aiSession.status === 'merging' && (
                    <div className="absolute inset-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-[2px] rounded-xl flex flex-col items-center justify-center gap-3 z-10 animate-in fade-in">
                      <LoaderCircle className="w-7 h-7 text-indigo-600 animate-spin" />
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        AI 正在分析差异并执行合并指令，请稍候...
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: AI Suggestions & Agent Command Interactive Panel (5 Cols) */}
              <div className="lg:col-span-5 flex flex-col min-h-0 bg-white dark:bg-slate-900">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 text-xs shrink-0">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>AI 合并建议与指令 (Agent)</span>
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {aiSession.messages.length} 条记录
                  </span>
                </div>

                {/* Messages & Suggestions Scrollable Box */}
                <div className="flex-1 p-4 space-y-3.5 overflow-y-auto min-h-0 text-xs">
                  {/* Primary Chinese Suggestions Card */}
                  {aiSession.suggestions && (
                    <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100 space-y-1.5 shadow-soft-sm">
                      <div className="font-semibold text-xs flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                        <span>AI 中文合并建议与说明:</span>
                      </div>
                      <div className="text-xs leading-relaxed whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-200">
                        {aiSession.suggestions}
                      </div>
                    </div>
                  )}

                  {/* Agent Dialog Stream */}
                  {aiSession.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-2.5 items-start ${
                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                          <Bot className="w-3.5 h-3.5" />
                        </div>
                      )}

                      <div
                        className={`p-3 rounded-2xl max-w-[85%] text-xs leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-tr-none'
                            : 'bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 rounded-tl-none whitespace-pre-wrap'
                        }`}
                      >
                        {msg.content}
                      </div>

                      {msg.role === 'user' && (
                        <div className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 mt-0.5">
                          <User className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                  ))}

                  {aiSession.error && (
                    <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs">
                      {aiSession.error}
                    </div>
                  )}
                </div>

                {/* Quick Directive Chips */}
                <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850 flex flex-wrap gap-1.5 text-[11px] shrink-0">
                  <span className="text-slate-400 self-center">快捷指令:</span>
                  {[
                    '优先采用本地实现的修改',
                    '同时保留双端全部代码',
                    '远端优先，仅合入本地字段',
                    '精简重复项并统一中文注释',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      disabled={aiSession.status === 'merging'}
                      onClick={() => setAgentInstruction(chip)}
                      className="px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors disabled:opacity-50"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                {/* Agent Prompt Input Bar */}
                <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900 flex gap-2 shrink-0">
                  <input
                    type="text"
                    value={agentInstruction}
                    onChange={(e) => setAgentInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleSendAgentInstruction();
                      }
                    }}
                    disabled={aiSession.status === 'merging'}
                    placeholder="向 AI 下达调整指令，例如：把第20行配置改为远端..."
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!agentInstruction.trim() || aiSession.status === 'merging'}
                    onClick={() => void handleSendAgentInstruction()}
                    className="gap-1 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>发送指令</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3.5 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 shrink-0">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                提示：合并状态在全局后台保持，切换到其他页面后可随时在顶部或冲突列表点击返回。
              </span>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onCloseAiMergeModal}
                  title="最小化并保留在后台，可随时返回查看"
                >
                  后台运行 (暂存)
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={onCancelAiMerge}
                  className="gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  放弃本次合并
                </Button>
                <Button
                  variant="accent"
                  size="md"
                  onClick={() => void onApplyAiMerge(localDraftContent)}
                  disabled={aiSession.status === 'merging' || aiSession.status === 'applying' || !localDraftContent.trim()}
                  className="gap-1.5"
                >
                  {aiSession.status === 'applying' ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  <span>{aiSession.status === 'applying' ? '正在写入两端…' : '确认写入两端'}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
