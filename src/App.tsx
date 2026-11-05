import { useState } from 'react';
import { DiscoveredProject } from './types/dto';
import { useSyncStore } from './stores/syncStore';
import { CommandRail } from './components/shell/CommandRail';
import { TopHeader } from './components/shell/TopHeader';
import { OverviewDashboard } from './features/overview/OverviewDashboard';
import { ProjectDetailView } from './features/projects/ProjectDetailView';
import { ConflictCenter } from './features/conflicts/ConflictCenter';
import { WebDavManager } from './features/webdav/WebDavManager';
import { SyncHistoryView } from './features/history/SyncHistoryView';
import { SettingsView } from './features/settings/SettingsView';
import { AddProjectWizard } from './features/wizard/AddProjectWizard';
import { ProjectManagementView } from './features/projects/ProjectManagementView';

export function App() {
  const {
    theme,
    toggleTheme,
    currentNav,
    setCurrentNav,
    selectedProjectId,
    openProjectDetail,
    roots,
    accounts,
    conflicts,
    tasks,
    history,
    isWizardOpen,
    setIsWizardOpen,
    loading,
    bannerAlert,
    refreshAll,
    handleSyncNow,
    handlePauseSync,
    handleResumeSync,
    handleEnableSync,
    handleRetryTask,
    handleResolveConflict,
  } = useSyncStore();

  const [remoteProject, setRemoteProject] = useState<DiscoveredProject | null>(null);
  const handleSyncAll = () => {
    roots.forEach((r) => handleSyncNow(r.id));
  };

  const handlePauseAll = () => {
    roots.forEach((r) => handlePauseSync(r.id));
  };

  const handleResumeAll = () => {
    roots.forEach((r) => handleResumeSync(r.id));
  };

  const navTitles = {
    overview: '工作区总览看板',
    projects: '项目管理',
    project_detail: '项目详情与控制台',
    webdav: 'WebDAV 远端节点管理',
    conflicts: '冲突拦截与版本裁决',
    history: '全量同步审计日志',
    settings: '系统配置与引擎参数',
  };

  return (
    <div className="app-shell flex h-screen w-screen overflow-hidden text-slate-800 dark:text-slate-100">
      {/* Command Rail */}
      <CommandRail
        currentNav={currentNav}
        onNavigate={(nav) => setCurrentNav(nav)}
        roots={roots}
        conflicts={conflicts}
        accounts={accounts}
        onOpenWizard={() => setIsWizardOpen(true)}
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <TopHeader
          title={navTitles[currentNav] || 'ProjectSync'}
          roots={roots}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSyncAll={handleSyncAll}
          onPauseAll={handlePauseAll}
          onResumeAll={handleResumeAll}
          bannerAlert={bannerAlert}
        />

        {/* Scrollable View Container */}
        <main className="flex-1 overflow-y-auto p-6 bg-transparent">
          {loading ? (
            <div className="h-full flex items-center justify-center font-mono text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                正在加载本地 SQLite 状态与调度任务队列...
              </div>
            </div>
          ) : (
            <>
              {currentNav === 'overview' && (
                <OverviewDashboard
                  roots={roots}
                  conflicts={conflicts}
                  accounts={accounts}
                  tasks={tasks}
                  onNavigate={(nav) => setCurrentNav(nav)}
                  onOpenDetail={openProjectDetail}
                  onOpenWizard={() => setIsWizardOpen(true)}
                  onSyncNow={handleSyncNow}
                  onPause={handlePauseSync}
                  onResume={handleResumeSync}
                  onEnable={handleEnableSync}
                  onRetryTask={handleRetryTask}
                />
              )}

              {currentNav === 'projects' && (
                <ProjectManagementView
                  roots={roots}
                  accounts={accounts}
                  onBindRemote={(project) => { setRemoteProject(project); setIsWizardOpen(true); }}
                  onOpenDetail={openProjectDetail}
                  onOpenWizard={() => { setRemoteProject(null); setIsWizardOpen(true); }}
                  onSyncNow={handleSyncNow}
                  onPause={handlePauseSync}
                  onResume={handleResumeSync}
                  onEnable={handleEnableSync}
                />
              )}

              {currentNav === 'project_detail' && selectedProjectId && (
                <ProjectDetailView
                  rootId={selectedProjectId}
                  roots={roots}
                  onBack={() => setCurrentNav('overview')}
                  onSyncNow={handleSyncNow}
                  onPause={handlePauseSync}
                  onResume={handleResumeSync}
                  onRefresh={refreshAll}
                />
              )}

              {currentNav === 'conflicts' && (
                <ConflictCenter
                  conflicts={conflicts}
                  onResolve={handleResolveConflict}
                />
              )}

              {currentNav === 'webdav' && (
                <WebDavManager
                  accounts={accounts}
                  onRefresh={refreshAll}
                />
              )}

              {currentNav === 'history' && (
                <SyncHistoryView history={history} />
              )}

              {currentNav === 'settings' && <SettingsView />}
            </>
          )}
        </main>
      </div>

      {/* 5-Step Project Wizard Modal */}
      <AddProjectWizard
        isOpen={isWizardOpen}
        remoteProject={remoteProject}
        onClose={() => { setIsWizardOpen(false); setRemoteProject(null); }}
        accounts={accounts}
        onProjectCreated={refreshAll}
      />
    </div>
  );
}
export default App;
