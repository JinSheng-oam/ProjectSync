import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { InitialSyncPreviewDto, SyncAction, SyncRuleDto } from '../../types/dto';
import { RulePathDiagnostics } from '../rules/RulePathDiagnostics';
import { SelectMenu } from '../../components/common/SelectMenu';

const actionLabels: Record<SyncAction, string> = {
  UploadNew: '上传新文件', UploadUpdate: '上传更新', DownloadNew: '下载新文件', DownloadUpdate: '下载更新',
  CreateConflictCopy: '待处理冲突', MarkClean: '内容一致', Blocked: '已受阻', Skip: '跳过',
  MoveLocalToTrash: '移入本地回收站', MoveRemoteToTrash: '移入远端回收站', AiMerge: 'AI 合并',
};

const groups = [
  { value: 'all', label: '全部结果' }, { value: 'Upload', label: '待上传' },
  { value: 'Download', label: '待下载' }, { value: 'CreateConflictCopy', label: '待处理冲突' },
  { value: 'Blocked', label: '已受阻' }, { value: 'MarkClean', label: '内容一致' },
];

interface InitialSyncPreviewProps {
  loadingPreview: boolean;
  previewData: InitialSyncPreviewDto | null;
  previewError: string | null;
  createError: string | null;
  submitting: boolean;
  localPath: string;
  remotePath: string;
  rules: SyncRuleDto[];
  excludeGitTracked: boolean;
}

export function InitialSyncPreview({ loadingPreview, previewData, previewError, createError, submitting, localPath, remotePath, rules, excludeGitTracked }: InitialSyncPreviewProps) {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(100);
  const items = previewData?.items.filter((item) =>
    filter === 'all' || item.action.startsWith(filter) ||
    (filter === 'Blocked' && item.action.startsWith('Move'))
  ) ?? [];

  return (
    <div className="space-y-4 py-2 text-xs">
      <dl className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-2">
        <div><dt className="text-slate-500 dark:text-slate-400">本地目录</dt><dd className="mt-1 break-all font-mono">{localPath}</dd></div>
        <div><dt className="text-slate-500 dark:text-slate-400">远端同步目标</dt><dd className="mt-1 break-all font-mono">{remotePath}</dd></div>
      </dl>
      {loadingPreview ? (
        <div role="status" className="py-8 text-center text-slate-600 dark:text-slate-300">
          <div className="mx-auto mb-2 size-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent motion-reduce:animate-none" />
          正在扫描两端目录并校验内容。文件较多时可能需要一些时间。
        </div>
      ) : previewData ? (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ['待上传', previewData.uploadsCount], ['待下载', previewData.downloadsCount],
              ['内容一致', previewData.identicalCount], ['待处理冲突', previewData.conflictsCount], ['已受阻', previewData.blockedCount],
            ].map(([label, count]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800">
                <dt className="text-slate-600 dark:text-slate-300">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{count} 项</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center justify-between gap-3">
            <span>同步计划 · {items.length} 个匹配结果</span>
            <SelectMenu label="同步计划筛选" value={filter} options={groups} onChange={(value) => { setFilter(value); setLimit(100); }} />
          </div>
          <ul className="max-h-48 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {items.slice(0, limit).map((item) => (
              <li key={item.relativePath} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-medium text-indigo-700 dark:text-indigo-300">{actionLabels[item.action]}</span>
                <span className="min-w-0 break-all font-mono">{item.relativePath}</span>
                <span className="text-slate-600 dark:text-slate-400">{item.reason}</span>
              </li>
            ))}
            {!items.length && <li className="p-3 text-slate-600 dark:text-slate-400">没有符合此筛选的文件。</li>}
          </ul>
          {items.length > limit && <button type="button" className="text-indigo-700 underline dark:text-indigo-300" onClick={() => setLimit((value) => value + 100)}>显示更多结果</button>}
          <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            确认后开始执行可同步项。冲突等待裁决，受阻项不会强制写入。
          </p>
          {createError && <p role="alert" className="text-rose-700 dark:text-rose-300">创建同步项目失败：{createError}</p>}
          {submitting && <p role="status">正在验证远端目标并保存项目…</p>}
        </>
      ) : (
        <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {previewError ? '无法生成预览：' + previewError : '尚未生成预览。'}
        </p>
      )}
      <RulePathDiagnostics {...{ rules, localPath, excludeGitTracked }} />
    </div>
  );
}
