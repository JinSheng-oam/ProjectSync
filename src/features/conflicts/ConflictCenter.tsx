import { useState } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  HardDrive,
  Cloud,
  FileCheck2,
  Copy,
  CheckCircle,
} from 'lucide-react';
import { ConflictItemDto, ConflictResolution } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';

interface ConflictCenterProps {
  conflicts: ConflictItemDto[];
  onResolve: (conflictId: string, resolution: ConflictResolution) => Promise<void>;
}

export function ConflictCenter({ conflicts, onResolve }: ConflictCenterProps) {
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

  const activeConflict = conflicts.find((c) => c.id === selectedId) || unresolvedConflicts[0];

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
      <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-5 shadow-soft-sm flex items-start justify-between">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>文件冲突处理</span>
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-medium">
                安全拦截已生效
              </span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
              安全保护机制：系统<strong>严禁静默覆盖不同内容的文件</strong>。当本地与远程 WebDAV 发生并发修改或存在内容分歧时，写操作将被挂起，需手动选择处理方案。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-aerospace-canvas px-3 py-2 rounded-lg border border-slate-200 dark:border-aerospace-border shrink-0">
          <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span>待处理冲突: <strong className="font-mono text-slate-900 dark:text-slate-200">{unresolvedConflicts.length}</strong></span>
        </div>
      </div>

      {unresolvedConflicts.length === 0 ? (
        <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-12 text-center space-y-3 shadow-soft-sm">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">当前没有未决冲突</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            本地工作目录与 WebDAV 远端文件完全一致，暂无冲突。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Conflict List (4 Cols) */}
          <div className="lg:col-span-4 bg-aerospace-surface border border-aerospace-border rounded-xl overflow-hidden shadow-soft-sm">
            <div className="px-4 py-3 border-b border-aerospace-border bg-slate-50/80 dark:bg-aerospace-rail/60 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">冲突列表</span>
              <span className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800 font-medium">
                <span className="font-mono">{unresolvedConflicts.length}</span> 个文件
              </span>
            </div>

            <div className="divide-y divide-aerospace-border/60 max-h-[600px] overflow-y-auto">
              {unresolvedConflicts.map((item) => {
                const isSelected = item.id === (activeConflict?.id || selectedId);
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`p-3.5 cursor-pointer transition-colors space-y-1.5 ${
                      isSelected
                        ? 'bg-amber-50/60 dark:bg-aerospace-elevated border-l-2 border-l-amber-500 text-slate-900 dark:text-slate-100'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/40 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-medium truncate max-w-[200px]" title={item.relativePath}>
                        {item.relativePath}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80">
                        {item.conflictType}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>发生于: <span className="font-mono">{new Date(item.detectedAt).toLocaleTimeString()}</span></span>
                      <span className="font-mono text-slate-400 dark:text-slate-500">{(item.localVersion.sizeBytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right 3-Way Comparison Inspector (8 Cols) */}
          {activeConflict && (
            <div className="lg:col-span-8 bg-aerospace-surface border border-aerospace-border rounded-xl p-5 shadow-soft-sm space-y-5">
              {/* Target File Info */}
              <div className="flex items-start justify-between pb-4 border-b border-aerospace-border">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono truncate">
                      {activeConflict.relativePath}
                    </h3>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                      项目 ID: {activeConflict.rootId}
                    </span>
                  </div>
                  <div className="text-xs text-amber-600 dark:text-amber-400 font-mono flex items-center gap-2">
                    <span>分歧类型: {activeConflict.conflictType}</span>
                    <span>•</span>
                    <span>拦截时间: {new Date(activeConflict.detectedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Three-Way Comparison Grid: Local Version vs WebDAV Remote Version */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Local Version Box */}
                <div className="bg-slate-50/70 dark:bg-aerospace-canvas border border-cyan-200 dark:border-cyan-800/60 rounded-xl p-4 space-y-3 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-cyan-700 dark:text-cyan-400 text-xs font-semibold">
                      <HardDrive className="w-4 h-4" />
                      <span>本地版本</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800 rounded font-medium">
                      本机修改
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1">
                      <span className="text-slate-500">修改设备:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-200">{activeConflict.localVersion.authorDevice}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1">
                      <span className="text-slate-500">文件大小:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-200">{activeConflict.localVersion.sizeBytes} 字节</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1">
                      <span className="text-slate-500">修改时间:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-200">
                        {new Date(activeConflict.localVersion.modifiedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="space-y-1 pt-1">
                      <span className="text-slate-500 text-[10px]">BLAKE3 内容哈希:</span>
                      <code className="block bg-white dark:bg-slate-900 p-1.5 rounded border border-slate-200 dark:border-slate-800 text-[10px] font-mono text-cyan-700 dark:text-cyan-300 truncate select-all">
                        {activeConflict.localVersion.blake3Hash}
                      </code>
                    </div>
                  </div>
                </div>

                {/* Remote WebDAV Version Box */}
                <div className="bg-slate-50/70 dark:bg-aerospace-canvas border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 space-y-3 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                      <Cloud className="w-4 h-4" />
                      <span>远端版本 (WebDAV)</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded font-medium">
                      云端节点
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1">
                      <span className="text-slate-500">存储服务:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-200">hacdias/webdav</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1">
                      <span className="text-slate-500">文件大小:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-200">{activeConflict.remoteVersion.sizeBytes} 字节</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1">
                      <span className="text-slate-500">修改时间:</span>
                      <span className="font-mono text-slate-900 dark:text-slate-200">
                        {new Date(activeConflict.remoteVersion.modifiedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="space-y-1 pt-1">
                      <span className="text-slate-500 text-[10px]">HTTP ETag 强标识:</span>
                      <code className="block bg-white dark:bg-slate-900 p-1.5 rounded border border-slate-200 dark:border-slate-800 text-[10px] font-mono text-amber-700 dark:text-amber-300 truncate select-all">
                        {activeConflict.remoteVersion.etag}
                      </code>
                    </div>
                  </div>
                </div>
              </div>

              {/* Baseline Info if present */}
              {activeConflict.baseVersion && (
                <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <FileCheck2 className="w-3.5 h-3.5 text-slate-500" />
                    共同基准版本: <span className="font-mono">{activeConflict.baseVersion.sizeBytes} 字节</span> (
                    <span className="font-mono">{new Date(activeConflict.baseVersion.modifiedAt).toLocaleTimeString()}</span>)
                  </span>
                  <code className="text-[10px] font-mono text-slate-500 truncate max-w-[240px]">
                    {activeConflict.baseVersion.blake3Hash}
                  </code>
                </div>
              )}

              {/* Triage Decision Actions */}
              <div className="pt-4 border-t border-aerospace-border space-y-3">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-200 flex items-center justify-between">
                  <span>冲突处理方案</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                    请选择满意的保留规则，确认后立即生效
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                    className="p-3.5 rounded-xl border border-cyan-300 dark:border-cyan-500/50 bg-cyan-50/60 dark:bg-cyan-950/20 hover:bg-cyan-100/60 dark:hover:bg-cyan-950/40 cursor-pointer transition-all space-y-1.5 shadow-sm"
                  >
                    <div className="text-xs font-semibold text-cyan-800 dark:text-cyan-300 flex items-center gap-1.5">
                      <Copy className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                      <span>保留双端版本 (推荐)</span>
                    </div>
                    <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-normal">
                      推荐首选。为远端内容创建独立冲突副本，本地修改原样保留，确保两端数据均不丢失。
                    </p>
                  </div>

                  {/* Action 2: KEEP_LOCAL */}
                  <div
                    onClick={() =>
                      setConfirmResolution({
                        id: activeConflict.id,
                        resolution: 'KeepLocal',
                        title: '确认以本地版本为准（覆盖远端）',
                        description: `本地版本将上传并覆盖 WebDAV 远端的对应文件。该操作会使用 If-Match 进行 ETag 校验，确保不影响后续新变更。`,
                      })
                    }
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-aerospace-canvas/60 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all space-y-1.5 shadow-soft-sm"
                  >
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      <span>以本地为准 (覆盖远端)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                      以本地修改为准，上传覆盖 WebDAV 远端内容。需通过 ETag 前置条件校验。
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
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-aerospace-canvas/60 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all space-y-1.5 shadow-soft-sm"
                  >
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Cloud className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      <span>以远端为准 (覆盖本地)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                      下载远端文件覆盖本地。本地当前文件会自动移入备份回收站 (.projectsync/trash)。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Conflict Action */}
      {confirmResolution && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-aerospace-surface border border-aerospace-borderLight rounded-xl shadow-soft-lg w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{confirmResolution.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">请核对本次操作的影响范围</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-aerospace-canvas p-3 rounded-lg border border-slate-200 dark:border-aerospace-border leading-relaxed">
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
                className="bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                {processing ? '正在处理...' : '确认解决'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
