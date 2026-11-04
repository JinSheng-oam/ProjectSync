import { useState } from 'react';
import {
  History,
  Search,
  Filter,
  Download,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { HistoryItemDto } from '../../types/dto';
import { Button } from '../../components/common/UIComponents';

export function SyncHistoryView({ history }: { history: HistoryItemDto[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredHistory = history.filter((item) => {
    const matchesSearch =
      item.relativePath.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.projectName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAction = actionFilter === 'ALL' || item.action === actionFilter;
    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchesSearch && matchesAction && matchesStatus;
  });

  const handleExportCSV = () => {
    const header = 'id,projectName,relativePath,action,status,bytes,timestamp,errorCode\n';
    const rows = filteredHistory
      .map(
        (h) =>
          `"${h.id}","${h.projectName}","${h.relativePath}","${h.action}","${h.status}",${h.bytes},"${new Date(h.timestamp).toISOString()}","${h.errorCode || ''}"`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `projectsync-audit-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-5 shadow-soft-sm flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-500/20 border border-cyan-200 dark:border-cyan-500/40 flex items-center justify-center text-cyan-600 dark:text-cyan-400 shrink-0">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">同步日志</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              记录本地与 WebDAV 之间的文件上传、下载、冲突副本生成与删除备份。
            </p>
          </div>
        </div>

        <Button
          variant="secondary"
          size="md"
          onClick={handleExportCSV}
          className="gap-2"
        >
          <Download className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          导出 CSV
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-3.5 shadow-soft-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="按文件名、项目名过滤..."
              className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-300 focus:outline-none focus:border-cyan-500 font-mono"
          >
            <option value="ALL">全部动作</option>
            <option value="UploadUpdate">UploadUpdate</option>
            <option value="DownloadUpdate">DownloadUpdate</option>
            <option value="CreateConflictCopy">CreateConflictCopy</option>
            <option value="MoveLocalToTrash">MoveLocalToTrash</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-300 focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">全部状态</option>
            <option value="SUCCESS">成功</option>
            <option value="BLOCKED">已拦截</option>
            <option value="FAILED">失败</option>
          </select>
        </div>
      </div>

      {/* History Ledger Table */}
      <div className="bg-aerospace-surface border border-aerospace-border rounded-xl overflow-hidden shadow-soft-sm">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-50 dark:bg-aerospace-rail/80 border-b border-aerospace-border text-slate-600 dark:text-slate-400 text-[11px]">
            <tr>
              <th className="py-2.5 px-4">执行时间</th>
              <th className="py-2.5 px-4">所属项目</th>
              <th className="py-2.5 px-4">同步动作</th>
              <th className="py-2.5 px-4">目标路径</th>
              <th className="py-2.5 px-4">状态与错误码</th>
              <th className="py-2.5 px-4 text-right">传输量</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-aerospace-border">
            {filteredHistory.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400 dark:text-slate-500">
                  没有找到符合筛选条件的同步历史
                </td>
              </tr>
            ) : (
              filteredHistory.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                    {new Date(item.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-slate-800 dark:text-slate-300 font-medium">{item.projectName}</td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        item.action.startsWith('Upload')
                          ? 'bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800'
                          : item.action === 'CreateConflictCopy'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                          : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                      }`}
                    >
                      {item.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200">{item.relativePath}</td>
                  <td className="py-2.5 px-4">
                    {item.status === 'SUCCESS' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        成功
                      </span>
                    ) : (
                      <div className="space-y-0.5">
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {item.errorCode || 'BLOCKED'}
                        </span>
                        {item.errorMessage && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-xs" title={item.errorMessage}>
                            {item.errorMessage}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-400">
                    {(item.bytes / 1024).toFixed(1)} KB
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
