import { useEffect, useRef, useState } from 'react';
import {
  History,
  Search,
  Filter,
  Download,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { HistoryItemDto, SyncAction } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';
import { api, HistoryFilters } from '../../services/api';
import { getErrorMessage } from '../../services/errorMessage';

import { SelectMenu } from '../../components/common/SelectMenu';

export function SyncHistoryView({ history }: { history: HistoryItemDto[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [filteredHistory, setFilteredHistory] = useState<HistoryItemDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pageSize = 100;

  const filters: HistoryFilters = {
    action: actionFilter === 'ALL' ? undefined : actionFilter as SyncAction,
    status: statusFilter === 'ALL' ? undefined : statusFilter as HistoryItemDto['status'],
  };

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setFilteredHistory([]);
    setHasMore(false);
    setError('');
    const timer = window.setTimeout(() => {
      void api.querySyncHistory(searchTerm, pageSize, undefined, 0, {
        action: actionFilter === 'ALL' ? undefined : actionFilter as SyncAction,
        status: statusFilter === 'ALL' ? undefined : statusFilter as HistoryItemDto['status'],
      }).then((rows) => {
        if (generation.current !== request) return;
        setFilteredHistory(rows);
        setHasMore(rows.length === pageSize);
      }).catch((cause: unknown) => {
        if (generation.current === request) setError(getErrorMessage(cause, '无法加载同步日志'));
      }).finally(() => {
        if (generation.current === request) setLoading(false);
      });
    }, 200);
    return () => { window.clearTimeout(timer); generation.current++; };
  }, [searchTerm, actionFilter, statusFilter, history[0]?.id]);

  const loadMore = async () => {
    const last = filteredHistory[filteredHistory.length - 1];
    if (!last || loading) return;
    const request = generation.current;
    setLoading(true);
    setError('');
    try {
      const rows = await api.querySyncHistory(searchTerm, pageSize, undefined, 0, {
        ...filters, before: { timestamp: last.timestamp, id: last.id },
      });
      if (generation.current !== request) return;
      setFilteredHistory((previous) => [...previous, ...rows]);
      setHasMore(rows.length === pageSize);
    } catch (cause: unknown) {
      if (generation.current === request) setError(getErrorMessage(cause, '无法加载更多日志'));
    } finally {
      if (generation.current === request) setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    setExporting(true);
    setError('');
    try {
      const allRows: HistoryItemDto[] = [];
      let before: HistoryFilters['before'];
      do {
        const rows = await api.querySyncHistory(searchTerm, 500, undefined, 0, { ...filters, before });
        allRows.push(...rows);
        if (rows.length < 500) break;
        const last = rows[rows.length - 1];
        if (before?.id === last.id && before.timestamp === last.timestamp) throw new Error('日志分页位置未前进');
        before = { timestamp: last.timestamp, id: last.id };
      } while (true);
      const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const rows = [
        ['id', 'projectName', 'relativePath', 'action', 'status', 'bytes', 'timestamp', 'errorCode', 'errorMessage'],
        ...allRows.map((h) => [h.id, h.projectName, h.relativePath, h.action, h.status, h.bytes, new Date(h.timestamp).toISOString(), h.errorCode ?? '', h.errorMessage ?? '']),
      ];
      const blob = new Blob(['\ufeff', rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `projectsync-audit-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, '导出同步日志失败'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-soft-sm flex items-center justify-between transition-colors">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">全量同步审计日志</h2>
          </div>
        </div>

        <Button
          variant="secondary"
          size="md"
          onClick={() => void handleExportCSV()}
          disabled={exporting}
          className="gap-2 shrink-0"
        >
          <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span>{exporting ? '正在导出…' : '导出 CSV'}</span>
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-soft-sm flex flex-wrap items-center justify-between gap-3 transition-colors">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="按文件名、项目名过滤..."
              className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 font-sans"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <SelectMenu label="同步动作" value={actionFilter} onChange={setActionFilter} options={[
            { value: 'ALL', label: '全部动作' },
            ...['UploadNew', 'UploadUpdate', 'DownloadNew', 'DownloadUpdate', 'MoveRemoteToTrash', 'MoveLocalToTrash', 'CreateConflictCopy', 'AiMerge', 'MarkClean', 'Skip', 'Blocked']
              .map((action) => ({ value: action, label: action })),
          ]} />
          <SelectMenu label="同步状态" value={statusFilter} onChange={setStatusFilter} options={[
            { value: 'ALL', label: '全部状态' },
            { value: 'SUCCESS', label: '成功' },
            { value: 'BLOCKED', label: '已拦截' },
            { value: 'FAILED', label: '失败' },
          ]} />
        </div>
      </div>

      {/* History Ledger Table with Horizontal Scroll Support to Prevent Truncation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-soft-sm transition-colors overflow-hidden">
        {error && <p role="alert" className="p-3 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs font-mono min-w-[840px] divide-y divide-slate-100 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 text-[11px]">
              <tr>
                <th className="py-2.5 px-4 font-medium w-44 min-w-[150px]">执行时间</th>
                <th className="py-2.5 px-4 font-medium w-36 min-w-[110px]">所属项目</th>
                <th className="py-2.5 px-4 font-medium w-40 min-w-[130px]">同步动作</th>
                <th className="py-2.5 px-4 font-medium min-w-[240px]">目标路径</th>
                <th className="py-2.5 px-4 font-medium w-44 min-w-[140px]">状态与错误码</th>
                <th className="py-2.5 px-4 font-medium text-right w-28 min-w-[90px]">传输量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400 font-sans">
                    {loading ? '正在加载同步记录…' : '没有找到符合筛选条件的同步历史记录'}
                  </td>
                </tr>
              ) : (
                filteredHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(item.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-slate-900 dark:text-slate-100 font-medium truncate max-w-[160px]" title={item.projectName}>
                      {item.projectName}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                          item.action.startsWith('Upload')
                            ? 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                            : item.action === 'CreateConflictCopy' || item.action === 'AiMerge'
                            ? 'bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                            : 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                        }`}
                      >
                        {item.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200 break-all max-w-sm" title={item.relativePath}>
                      {item.relativePath}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {item.status === 'SUCCESS' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          成功
                        </span>
                      ) : (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {item.errorCode || 'BLOCKED'}
                          </span>
                          {item.errorMessage && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs" title={item.errorMessage}>
                              {item.errorMessage}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {(item.bytes / 1024).toFixed(1)} KB
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {(filteredHistory.length > 0 || hasMore) && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>已加载 {filteredHistory.length} 项同步操作</span>
            {hasMore && <Button variant="secondary" size="sm" disabled={loading} onClick={() => void loadMore()}>{loading ? '加载中…' : '加载更多'}</Button>}
          </div>
        )}
      </div>
    </div>
  );
}
