import { useState } from 'react';
import {
  Server,
  Plus,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Gauge,
  Trash2,
  Pencil,
} from 'lucide-react';
import { WebDavAccountDto, WebDavCapabilities } from '../../types/dto';
import { Button, Modal } from '../../components/common/UIComponents';
import { api } from '../../services/api';

interface WebDavManagerProps {
  accounts: WebDavAccountDto[];
  onRefresh: () => void;
}

export function WebDavManager({ accounts, onRefresh }: WebDavManagerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://dav.example.com/webdav');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tlsVerify, setTlsVerify] = useState(true);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<WebDavCapabilities | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteAccount = async (accountId: string, accountName: string) => {
    if (!window.confirm(`删除 WebDAV 节点“${accountName}”？正在使用它的项目需要先解除绑定。`)) return;
    setDeletingId(accountId);
    try {
      await api.deleteWebDavAccount(accountId);
      onRefresh();
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const openCreateAccount = () => {
    setEditingAccountId(null);
    setName('');
    setUrl('https://dav.example.com/webdav');
    setUsername('');
    setPassword('');
    setTlsVerify(true);
    setTestResult(null);
    setTestError(null);
    setIsModalOpen(true);
  };

  const openEditAccount = (account: WebDavAccountDto) => {
    setEditingAccountId(account.id);
    setName(account.name);
    setUrl(account.url);
    setUsername(account.username);
    setPassword('');
    setTlsVerify(account.tlsVerify);
    setTestResult(null);
    setTestError(null);
    setIsModalOpen(true);
  };

  const handleTestConnection = async () => {
    if (editingAccountId && !password) {
      setTestError('重新探测时请填写密码；留空只适用于不修改密码直接保存节点信息。');
      return;
    }
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await api.testWebDavConnection(url, username, password, tlsVerify);
      setTestResult(res);
    } catch (err: unknown) {
      setTestError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAccount = async () => {
    if (!name.trim() || !url.trim() || !username.trim() || (!editingAccountId && !password)) {
      alert('请完整填写名称、URL、用户名与密码');
      return;
    }
    setSaving(true);
    try {
      if (editingAccountId) {
        await api.updateWebDavAccount(editingAccountId, { name, url, username, password: password || undefined, tlsVerify });
      } else {
        await api.createWebDavAccount({ name, url, username, password, tlsVerify });
      }
      setIsModalOpen(false);
      setEditingAccountId(null);
      setName('');
      setPassword('');
      setTestResult(null);
      onRefresh();
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-aerospace-surface border border-aerospace-border rounded-xl p-5 shadow-soft-sm flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-300 dark:border-emerald-500/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>WebDAV 存储节点</span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 font-medium">
                标准 WebDAV 兼容
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              账号凭据通过系统凭据管理器安全存储，不会以明文形式保存在配置文件中。
            </p>
          </div>
        </div>

        <Button variant="primary" size="md" onClick={openCreateAccount} className="gap-1.5">
          <Plus className="w-4 h-4" />
          添加 WebDAV 节点
        </Button>
      </div>

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="bg-aerospace-surface border border-aerospace-border rounded-xl p-5 shadow-soft-sm space-y-4 hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-aerospace-elevated border border-aerospace-borderLight flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{acc.name}</h3>
                  <code className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate block max-w-xs">{acc.url}</code>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${acc.status === 'ONLINE' ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${acc.status === 'ONLINE' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                  {acc.status === 'ONLINE' ? '在线' : acc.status === 'AUTH_FAILED' ? '认证失败' : acc.status === 'OFFLINE' ? '离线' : '未探测'}
                </span>
                <button type="button" onClick={() => openEditAccount(acc)} aria-label={`编辑 ${acc.name}`} className="rounded p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button type="button" disabled={deletingId === acc.id} onClick={() => handleDeleteAccount(acc.id, acc.name)} aria-label={`删除 ${acc.name}`} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-aerospace-canvas p-3 rounded-lg border border-slate-200 dark:border-aerospace-border text-xs space-y-1 text-slate-600 dark:text-slate-400">
              <div className="flex justify-between">
                <span>用户名:</span>
                <span className="font-mono text-slate-900 dark:text-slate-200">{acc.username}</span>
              </div>
              <div className="flex justify-between">
                <span>凭据安全引用:</span>
                <span className="font-mono text-indigo-700 dark:text-indigo-400 truncate max-w-[200px]">{acc.credentialRef}</span>
              </div>
              <div className="flex justify-between">
                <span>TLS 证书校验:</span>
                <span className={acc.tlsVerify ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-400 dark:text-slate-500'}>
                  {acc.tlsVerify ? '已开启' : '关闭 (HTTP)'}
                </span>
              </div>
            </div>

            {/* Verified Capabilities Badges */}
            {acc.capabilities && (
              <div className="space-y-2 pt-2 border-t border-aerospace-border">
                <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>服务端兼容性探测结果 (Runtime Profile)</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  <div className="bg-slate-100 dark:bg-slate-900/80 p-2 rounded border border-slate-200 dark:border-slate-800 flex justify-between">
                    <span>ETag 强校验:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{acc.capabilities.etagType}</span>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-900/80 p-2 rounded border border-slate-200 dark:border-slate-800 flex justify-between">
                    <span>If-Match 保护:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                      {acc.capabilities.supportsIfMatch ? '支持' : '不支持'}
                    </span>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-900/80 p-2 rounded border border-slate-200 dark:border-slate-800 flex justify-between">
                    <span>独占锁写保护:</span>
                    <span className={acc.capabilities.supportsLock ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-500 dark:text-slate-500 font-bold'}>
                      {acc.capabilities.supportsLock ? '实测通过' : '未验证'}
                    </span>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-900/80 p-2 rounded border border-slate-200 dark:border-slate-800 flex justify-between">
                    <span>PROPFIND Depth 1:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">通过</span>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-900/80 p-2 rounded border border-slate-200 dark:border-slate-800 flex justify-between">
                    <span>吞吐带宽:</span>
                    <span className="text-indigo-700 dark:text-indigo-400 font-bold">
                      {typeof acc.capabilities.maxUploadSpeedMbs === 'number' ? `~${acc.capabilities.maxUploadSpeedMbs} MB/s` : '未测量'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add WebDAV Account Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingAccountId ? '编辑 WebDAV 节点' : '添加 WebDAV 远端节点'}
        subtitle="填写服务器连接参数，执行兼容性与并发保护能力探测"
        maxWidth="max-w-xl"
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">节点备注名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: Home-NAS-WebDAV"
              className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">WebDAV URL 根地址</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://dav.example.com/webdav"
              className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">登录用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">访问密码（安全保存在凭据管理器）</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editingAccountId ? '留空则保留当前密码' : '••••••••'}
                className="w-full bg-white dark:bg-aerospace-canvas border border-slate-300 dark:border-aerospace-border rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="tlsCheck"
              checked={tlsVerify}
              onChange={(e) => setTlsVerify(e.target.checked)}
              className="rounded bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-0"
            />
            <label htmlFor="tlsCheck" className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              强制验证 TLS 证书 (内网自签名证书请取消勾选)
            </label>
          </div>

          {/* Test Connection Button */}
          <div className="pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={handleTestConnection}
              disabled={testing}
              className="w-full gap-2 font-mono"
            >
              <Gauge className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              {testing ? '正在探测 PROPFIND、条件写入与 MOVE 能力…' : '探测服务端能力'}
            </Button>
          </div>

          {/* Test Results Display */}
          {testResult && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/60 rounded-xl p-3.5 space-y-2 font-mono text-xs text-emerald-800 dark:text-emerald-300">
              <div className="font-semibold flex items-center gap-2 text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                探测成功！已成功识别服务端特性：
              </div>
              <div>• Server 标头: {testResult.serverHeader}</div>
              <div>• ETag 强语义: {testResult.etagType}</div>
              <div>• 并发写防护 If-Match: {testResult.supportsIfMatch ? '支持' : '不支持'}</div>
              <div>• WebDAV 独占锁写保护: {testResult.supportsLock ? '已验证' : '未验证'}</div>
              <div>• 安全新建: {testResult.safeCreateOnly ? (testResult.supportsIfNoneMatch ? 'If-None-Match' : '独占锁') : '未验证'}</div>
              <div>• 受保护的 MOVE: {testResult.safeMoveNoOverwrite ? '支持' : '未验证'}</div>
              <div>• 测得带宽: {typeof testResult.maxUploadSpeedMbs === 'number' ? `~${testResult.maxUploadSpeedMbs} MB/s` : '未测量'}</div>
              {testResult.probeCleanupWarning && (
                <div className="text-amber-700 dark:text-amber-300">• {testResult.probeCleanupWarning}</div>
              )}
            </div>
          )}

          {testError && (
            <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 rounded-xl p-3 font-mono text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>探测失败: {testError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-aerospace-border">
            <Button variant="ghost" size="md" onClick={() => setIsModalOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSaveAccount}
              disabled={saving}
              className="bg-telemetry-indigo hover:bg-[#6562dd]"
            >
              {saving ? '正在保存…' : editingAccountId ? '保存修改' : '保存 WebDAV 节点'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
