import { useEffect, useState } from 'react';
import { Check, FolderSync, Settings, Shield } from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { api } from '../../services/api';

export function SettingsView() {
  const [deviceName, setDeviceName] = useState('ProjectSync Device');
  const [autostart, setAutostart] = useState(false);
  const [startMinimized, setStartMinimized] = useState(false);
  const [defaultPollInterval, setDefaultPollInterval] = useState(60);
  const [defaultDebounce, setDefaultDebounce] = useState(1200);
  const [retryLimit, setRetryLimit] = useState(5);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.getAppSettings().then((settings) => {
      if (!active || !settings) return;
      setDeviceName(settings.deviceName);
      setAutostart(settings.autoStart);
      setStartMinimized(settings.startMinimized);
      setDefaultPollInterval(settings.pollIntervalSeconds);
      setDefaultDebounce(settings.debounceMs);
      setRetryLimit(settings.retryLimit);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '读取设置失败');
    });
    return () => { active = false; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateAppSettings({
        deviceName,
        autoStart: autostart,
        startMinimized,
        pollIntervalSeconds: defaultPollInterval,
        debounceMs: defaultDebounce,
        retryLimit,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '保存设置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleExportDiagnostics = async () => {
    if (!window.confirm('诊断包包含项目和 WebDAV 能力状态、最近任务错误代码与同步计量；不会包含本地/远端目录、文件名、账号用户名、密码或文件内容。继续导出吗？')) return;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const destination = await save({
        title: '导出 ProjectSync 诊断包',
        defaultPath: 'ProjectSync-diagnostics.zip',
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      });
      if (destination) await api.exportDiagnostics(destination);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '导出诊断包失败');
    }
  };

  const handleBackupDatabase = async () => {
    if (!window.confirm('本地状态数据库包含项目路径、同步任务和历史记录，但不保存 WebDAV 密码或同步文件内容。立即创建一致性备份吗？')) return;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const destination = await save({
        title: '备份 ProjectSync 状态数据库',
        defaultPath: `projectsync-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
        filters: [{ name: 'SQLite database', extensions: ['db'] }],
      });
      if (!destination) return;
      const bytes = await api.backupDatabase(destination);
      setBackupMessage(`数据库备份完成（${(bytes / 1024).toFixed(1)} KB）`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '备份数据库失败');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-soft-sm flex items-center justify-between transition-colors">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">系统配置与引擎参数</h2>
          </div>
        </div>
        <Button variant="primary" size="md" onClick={handleSave} disabled={saving} className="gap-2">
          {saved ? <Check className="w-4 h-4 text-emerald-300" /> : null}
          <span>{saving ? '正在保存…' : saved ? '已保存' : '保存设置'}</span>
        </Button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-soft-sm space-y-4 transition-colors">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FolderSync className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span>设备与启动</span>
        </h3>
        <div className="space-y-1.5">
          <label className="text-xs text-slate-700 dark:text-slate-300 font-medium" htmlFor="device-name">设备名称</label>
          <input id="device-name" value={deviceName} maxLength={64} onChange={(event) => setDeviceName(event.target.value)} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500" />
        </div>
        <ToggleRow title="登录 Windows 后自动启动" checked={autostart} onChange={setAutostart} />
        <ToggleRow title="启动后最小化到托盘" checked={startMinimized} onChange={setStartMinimized} />
      </section>

      {api.isTauri && (
        <div className="flex flex-col items-end gap-2">
          {backupMessage && <span role="status" className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">{backupMessage}</span>}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleBackupDatabase}>备份状态数据库</Button>
            <Button variant="secondary" size="sm" onClick={handleExportDiagnostics}>导出脱敏诊断包</Button>
          </div>
        </div>
      )}

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-soft-sm space-y-4 transition-colors">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>同步默认值与重试机制</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <NumberField label="新项目远端轮询周期（秒）" value={defaultPollInterval} min={10} max={86400} onChange={setDefaultPollInterval} />
          <NumberField label="本地变更防抖时间（毫秒）" value={defaultDebounce} min={100} max={30000} onChange={setDefaultDebounce} />
          <NumberField label="网络错误最多重试次数" value={retryLimit} min={1} max={20} onChange={setRetryLimit} />
        </div>
      </section>
    </div>
  );
}

function ToggleRow(props: { title: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 cursor-pointer hover:bg-slate-100/70 dark:hover:bg-slate-800/80 transition-colors">
      <div>
        <div className="text-xs text-slate-900 dark:text-slate-100 font-medium">{props.title}</div>
      </div>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} className="rounded w-4 h-4 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-0 cursor-pointer" />
    </label>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-slate-700 dark:text-slate-300 font-medium">{props.label}</label>
      <input type="number" min={props.min} max={props.max} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-500" />
    </div>
  );
}
