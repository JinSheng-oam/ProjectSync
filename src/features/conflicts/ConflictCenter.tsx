import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ShieldAlert,
  HardDrive,
  Cloud,
  FileCheck2,
  Copy,
  CheckCircle,
  LoaderCircle,
  Sparkles,
  EyeOff,
} from 'lucide-react';
import { AiSettingsDto, ConflictItemDto, ConflictResolution, SyncRootDto } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';
import { AiMergeSession } from '../../stores/syncStore';

interface ConflictCenterProps {
  conflicts: ConflictItemDto[];
  roots: SyncRootDto[];
  onResolve: (conflictId: string, resolution: ConflictResolution) => Promise<void>;
  onExcludeFile: (conflictId: string) => Promise<void>;
  aiSession?: AiMergeSession | null;
  aiMergeQueue: string[];
  mergeResults: { applied: number; skipped: number; failed: number };
  onEnqueueAiMerges: (ids: string[]) => void;
  onClearAiMergeQueue: () => void;
  onOpenAiMergeModal: () => void;
  onOpenAiSettings: () => void;
}

export function ConflictCenter({
  conflicts,
  roots,
  onResolve,
  onExcludeFile,
  aiSession,
  aiMergeQueue,
  mergeResults,
  onEnqueueAiMerges,
  onClearAiMergeQueue,
  onOpenAiMergeModal,
  onOpenAiSettings,
}: ConflictCenterProps) {
  const unresolvedConflicts = conflicts.filter((c) => c.status === 'UNRESOLVED');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
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
  const [excludeConfirmation, setExcludeConfirmation] = useState<{ id: string; path: string } | null>(null);

  const activeConflict = unresolvedConflicts.find((c) => c.id === selectedId) || unresolvedConflicts[0];
  const activeProjectName = activeConflict
    ? roots.find((root) => root.id === activeConflict.rootId)?.name
    : undefined;

  useEffect(() => {
    let active = true;
    api.getAiSettings()
      .then((value) => { if (active) setAiSettings(value); })
      .catch(() => { if (active) setAiSettings(null); });
    return () => { active = false; };
  }, []);

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

  const handleApplyExclusion = async () => {
    if (!excludeConfirmation) return;
    setProcessing(true);
    try {
      await onExcludeFile(excludeConfirmation.id);
      setExcludeConfirmation(null);
    } catch {
      // Keep open so user can retry
    } finally {
      setProcessing(false);
    }
  };

  const isAiMergingThis = Boolean(aiSession && aiSession.conflictId === activeConflict?.id);
  const aiConfigured = Boolean(aiSettings?.configured || aiSettings?.useCodexForMerge);
  const queuedIds = new Set(aiMergeQueue);
  const selectableIds = unresolvedConflicts
    .filter((item) => item.hasLocalVersion && item.hasRemoteVersion &&
      item.id !== aiSession?.conflictId && !queuedIds.has(item.id))
    .map((item) => item.id);
  const selectedBatch = selectableIds.filter((id) => checkedIds.includes(id));
  const allChecked = selectableIds.length > 0 && selectedBatch.length === selectableIds.length;
  const isActiveQueued = activeConflict ? queuedIds.has(activeConflict.id) : false;
  const missingVersion = activeConflict && (!activeConflict.hasLocalVersion ? '本地' : !activeConflict.hasRemoteVersion ? '远端' : null);
  const conflictLabels: Record<ConflictItemDto['conflictType'], string> = {
    ConcurrentModification: '两端均已修改', InitialSyncDifferent: '首次同步内容不同',
    LocalDeleteRemoteModified: '本地删除、远端修改', RemoteDeleteLocalModified: '远端删除、本地修改',
    CaseCollision: '文件名大小写冲突',
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
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
          <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span>待处理冲突: <strong className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">{unresolvedConflicts.length}</strong></span>
        </div>
      </div>

      {mergeResults.applied + mergeResults.skipped + mergeResults.failed > 0 && (
        <p role="status" className="text-xs text-slate-600 dark:text-slate-300">
          本轮 AI 评审：已写入 {mergeResults.applied} · 已跳过 {mergeResults.skipped} · 未处理的失败 {mergeResults.failed}
        </p>
      )}
      {unresolvedConflicts.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center space-y-3 shadow-soft-sm transition-colors">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">当前没有未决冲突</h3>
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

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={allChecked}
                  disabled={selectableIds.length === 0}
                  onChange={() => setCheckedIds(allChecked ? [] : selectableIds)}
                  className="accent-indigo-600"
                />
                全选可合并文件
              </label>
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedBatch.length === 0}
                onClick={() => {
                  if (!aiConfigured) {
                    onOpenAiSettings();
                    return;
                  }
                  onEnqueueAiMerges(selectedBatch);
                  setCheckedIds([]);
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                批量 AI 合并{selectedBatch.length > 0 ? `（${selectedBatch.length}）` : ''}
              </Button>
            </div>
            {aiConfigured && <p className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400">
              合并会把所选文件的本地与远端文本发送至 {aiSettings?.useCodexForMerge ? 'Codex CLI' : '已配置的 AI 服务'}。
            </p>}
            {aiMergeQueue.length > 0 && (
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                <span role="status">{aiMergeQueue.length} 个文件排队</span>
                <button type="button" onClick={onClearAiMergeQueue} className="text-indigo-700 hover:underline dark:text-indigo-300">
                  清空等待队列
                </button>
              </div>
            )}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
              {unresolvedConflicts.map((item) => {
                const isSelected = item.id === (activeConflict?.id || selectedId);
                const hasSession = aiSession && aiSession.conflictId === item.id;
                const canMerge = item.hasLocalVersion && item.hasRemoteVersion;
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
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${item.relativePath}`}
                          checked={canMerge && checkedIds.includes(item.id) && !hasSession && !queuedIds.has(item.id)}
                          disabled={!canMerge || Boolean(hasSession) || queuedIds.has(item.id)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setCheckedIds((ids) => checked ? [...ids, item.id] : ids.filter((id) => id !== item.id));
                          }}
                          className="accent-indigo-600"
                        />
                        <button type="button" aria-pressed={isSelected} onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); }}
                          className="min-w-0 truncate rounded text-left text-xs font-mono font-medium focus-visible:outline-indigo-600" title={item.relativePath}>
                          {item.relativePath}
                        </button>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasSession && (
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" />
                            {aiSession.status === 'merging' ? '合并中' : aiSession.status === 'error' ? '合并失败' : 'AI 待审'}
                          </span>
                        )}
                        {queuedIds.has(item.id) && <span className="text-[11px] text-indigo-600 dark:text-indigo-300">排队中</span>}
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                          {conflictLabels[item.conflictType]}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                      <span className="truncate" title={roots.find((root) => root.id === item.rootId)?.name}>
                        {roots.find((root) => root.id === item.rootId)?.name ?? '未知项目'}
                      </span>
                      <span>{!item.hasLocalVersion ? '本地版本缺失' : !item.hasRemoteVersion ? '远端版本缺失' : `${(item.localVersion.sizeBytes / 1024).toFixed(1)} KB`}</span>
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
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono truncate">
                      {activeConflict.relativePath}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      项目: <span className="font-mono">{activeProjectName || activeConflict.rootId}</span>
                    </span>
                  </div>
                  <div className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <span>分歧类型: <span className="font-mono">{activeConflict.conflictType}</span></span>
                    <span>•</span>
                    <span>拦截时间: <span className="font-mono tabular-nums">{new Date(activeConflict.detectedAt).toLocaleString()}</span></span>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  onClick={() => setExcludeConfirmation({ id: activeConflict.id, path: activeConflict.relativePath })}
                >
                  <EyeOff className="w-3.5 h-3.5" /> 排除此文件
                </Button>
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
                  <button type="button" disabled={Boolean(missingVersion)}
                    onClick={() =>
                      setConfirmResolution({
                        id: activeConflict.id,
                        resolution: 'KeepBoth',
                        title: '确认保留双端版本（推荐）',
                        description: '先将本地版本保存为远端冲突副本；若远端不支持安全新建，则备份到 ProjectSync 回收站。然后用远端版本替换本地同步文件。',
                      })
                    }
                    className="p-3.5 text-left focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50/70 dark:bg-indigo-950/30 hover:bg-indigo-100/70 dark:hover:bg-indigo-950/50 cursor-pointer transition-all space-y-1.5 shadow-soft-sm"
                  >
                    <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-300 flex items-center gap-1.5">
                      <Copy className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span>保留双端版本 (推荐)</span>
                    </span>
                    <span className="block text-[11px] text-slate-700 dark:text-slate-300 leading-normal">
                      先备份本地版本，再让本地同步文件采用远端内容。
                    </span>
                  </button>

                  {/* Action 2: AI text merge with Agent Refinement */}
                  <button type="button" disabled={Boolean(missingVersion) || isActiveQueued}
                    className={`p-3.5 text-left focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 rounded-xl border space-y-1.5 shadow-soft-sm transition-all cursor-pointer ${
                      isAiMergingThis
                        ? 'border-indigo-500 bg-indigo-50/80 dark:border-indigo-500 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20'
                        : aiConfigured && !missingVersion
                        ? 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/70 dark:border-amber-700 dark:bg-amber-950/20 dark:hover:bg-amber-950/40'
                        : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60'
                    }`}
                    onClick={() => {
                      if (missingVersion) return;
                      if (!aiConfigured) {
                        onOpenAiSettings();
                        return;
                      }
                      if (isAiMergingThis) {
                        onOpenAiMergeModal();
                      } else if (!isActiveQueued) {
                        onEnqueueAiMerges([activeConflict.id]);
                      }
                    }}
                  >
                    <span className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <span>
                          {isAiMergingThis ? aiSession?.status === 'merging'
                              ? 'AI 正在后台合并中…'
                              : '查看 AI 合并审阅面板'
                            : missingVersion ? '无法 AI 合并' : aiConfigured
                            ? isActiveQueued ? '已加入队列' : aiSession ? '加入 AI 合并队列' : 'AI 智能合并与建议'
                            : '配置 AI 合并'}
                        </span>
                      </span>
                      {isAiMergingThis && aiSession?.status === 'merging' && (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-amber-600" />
                      )}
                    </span>
                    <span className="block text-[11px] leading-normal text-slate-600 dark:text-slate-400">
                      {isAiMergingThis
                        ? '已保留合并状态，点击即可继续与 AI Agent 交互微调并确认写入。'
                        : missingVersion
                        ? `${missingVersion}版本不存在，请选择保留现存版本或手动裁决。`
                        : isActiveQueued
                        ? '当前文件将在前面的文件评审结束后处理。'
                        : aiConfigured
                        ? '生成合并草稿，审阅后逐个确认写入。'
                        : '请先选择并保存 AI 合并后端。'}
                    </span>
                  </button>

                  {/* Action 3: KEEP_LOCAL */}
                  <button type="button" disabled={!activeConflict.hasLocalVersion}
                    onClick={() =>
                      setConfirmResolution({
                        id: activeConflict.id,
                        resolution: 'KeepLocal',
                        title: activeConflict.hasRemoteVersion ? '确认以本地版本为准' : '确认恢复远端文件',
                        description: activeConflict.hasRemoteVersion ? '上传本地版本覆盖远端。写入前将重新核对版本。' : '上传现存的本地版本，在远端安全新建此文件。',
                      })
                    }
                    className="p-3.5 text-left focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all space-y-1.5 shadow-soft-sm"
                  >
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      <span>{activeConflict.hasRemoteVersion ? '以本地为准' : '恢复到远端'}</span>
                    </span>
                    <span className="block text-[11px] text-slate-600 dark:text-slate-400 leading-normal">
                      {activeConflict.hasRemoteVersion ? '使用本地内容覆盖远端。' : '把现存的本地版本上传到远端。'}
                    </span>
                  </button>

                  {/* Action 4: KEEP_REMOTE */}
                  <button type="button" disabled={!activeConflict.hasRemoteVersion}
                    onClick={() =>
                      setConfirmResolution({
                        id: activeConflict.id,
                        resolution: 'KeepRemote',
                        title: activeConflict.hasLocalVersion ? '确认以远端版本为准' : '确认恢复本地文件',
                        description: activeConflict.hasLocalVersion ? '备份当前本地版本，再用远端版本替换。' : '下载现存的远端版本，恢复本地文件。',
                      })
                    }
                    className="p-3.5 text-left focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all space-y-1.5 shadow-soft-sm"
                  >
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Cloud className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      <span>{activeConflict.hasLocalVersion ? '以远端为准' : '恢复到本地'}</span>
                    </span>
                    <span className="block text-[11px] text-slate-600 dark:text-slate-400 leading-normal">
                      {activeConflict.hasLocalVersion ? '下载远端内容，备份并替换本地文件。' : '把现存的远端版本下载到本地。'}
                    </span>
                  </button>
                </div>

                {isAiMergingThis && aiSession?.error && (
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

      {excludeConfirmation && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-soft-lg w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
                <EyeOff className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">将此文件加入排除规则？</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">该文件以后不会参与此项目的同步</p>
              </div>
            </div>
            <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 leading-relaxed space-y-1.5">
              <p className="font-mono break-all">{excludeConfirmation.path}</p>
              <p>本地和远端现有文件都会保留，只有这个相对路径会被排除。</p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="secondary" size="md" onClick={() => setExcludeConfirmation(null)} disabled={processing}>返回</Button>
              <Button variant="primary" size="md" onClick={handleApplyExclusion} disabled={processing}>
                {processing ? '正在更新规则…' : '确认排除文件'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Confirmation Modal for Standard Conflict Action */}
      {confirmResolution && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-soft-lg w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{confirmResolution.title}</h3>
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
        </div>,
        document.body
      )}
    </div>
  );
}
export default ConflictCenter;
