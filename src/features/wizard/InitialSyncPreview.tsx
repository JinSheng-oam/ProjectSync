import { AlertTriangle } from 'lucide-react';
import { InitialSyncPreviewDto } from '../../types/dto';


interface InitialSyncPreviewProps {
  loadingPreview: boolean;
  previewData: InitialSyncPreviewDto | null;
  previewError: string | null;
  createError: string | null;
  submitting: boolean;
}

export function InitialSyncPreview({ loadingPreview, previewData, previewError, createError, submitting }: InitialSyncPreviewProps) {
  return (
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
              确认后立即开始同步。
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
  );
}
