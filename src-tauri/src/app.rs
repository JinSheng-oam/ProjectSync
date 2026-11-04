use crate::{
    domain::{AppError, AppResult, SyncRootDto},
    storage::Database,
    sync_engine::SyncCoordinator,
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::{sync::mpsc, task::JoinHandle, time::Instant};
use tracing_appender::non_blocking::WorkerGuard;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub sync: SyncCoordinator,
    pub data_dir: PathBuf,
    watchers: Arc<Mutex<HashMap<String, RecommendedWatcher>>>,
    watch_sender: mpsc::UnboundedSender<String>,
    watch_receiver: Arc<Mutex<Option<mpsc::UnboundedReceiver<String>>>>,
    _log_guard: Arc<Mutex<Option<WorkerGuard>>>,
}

impl AppState {
    pub async fn initialize(app: &AppHandle) -> AppResult<Self> {
        let data_dir = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or(
                app.path()
                    .app_local_data_dir()
                    .map_err(|e| AppError::new("APP_PATH_ERROR", e.to_string()))?,
            )
            .join("ProjectSync");
        let logs = data_dir.join("logs");
        let db_path = data_dir.join("data").join("projectsync.db");
        tokio::fs::create_dir_all(&logs).await?;
        prune_old_logs(&logs, 30).await;
        for directory in [
            data_dir.join("cache"),
            data_dir.join("staging"),
            data_dir.join("trash"),
        ] {
            tokio::fs::create_dir_all(directory).await?;
        }
        let appender = tracing_appender::rolling::daily(&logs, "app.log");
        let (writer, guard) = tracing_appender::non_blocking(appender);
        let filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,projectsync=debug"));
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_writer(writer)
            .try_init();
        let db = Database::open(&db_path).await?;
        db.recover_interrupted().await?;
        let sync = SyncCoordinator::new(db.clone(), data_dir.clone(), app.clone());
        let (watch_sender, watch_receiver) = mpsc::unbounded_channel();
        Ok(Self {
            db,
            sync,
            data_dir,
            watchers: Arc::new(Mutex::new(HashMap::new())),
            watch_sender,
            watch_receiver: Arc::new(Mutex::new(Some(watch_receiver))),
            _log_guard: Arc::new(Mutex::new(Some(guard))),
        })
    }

    pub fn install_watcher(&self, root: &SyncRootDto) -> AppResult<()> {
        if !root.enabled {
            self.remove_watcher(&root.id);
            return Ok(());
        }
        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| AppError::new("WATCHER_ERROR", "本地文件监听状态不可用"))?;
        if watchers.contains_key(&root.id) {
            return Ok(());
        }
        let tx = self.watch_sender.clone();
        let root_id = root.id.clone();
        let mut watcher = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                if let Ok(event) = result {
                    if !matches!(event.kind, notify::EventKind::Access(_)) {
                        let _ = tx.send(root_id.clone());
                    }
                }
            },
            notify::Config::default(),
        )
        .map_err(|e| AppError::new("WATCHER_ERROR", format!("创建本地文件监听失败：{e}")))?;
        watcher
            .watch(&PathBuf::from(&root.local_path), RecursiveMode::Recursive)
            .map_err(|e| AppError::new("WATCHER_ERROR", format!("监听本地同步目录失败：{e}")))?;
        watchers.insert(root.id.clone(), watcher);
        Ok(())
    }

    pub fn remove_watcher(&self, root_id: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.remove(root_id);
        }
    }

    pub fn start_background(&self, app: AppHandle) {
        let receiver = self
            .watch_receiver
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());
        let Some(mut receiver) = receiver else {
            return;
        };
        let state = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut debounce: HashMap<String, JoinHandle<()>> = HashMap::new();
            let mut last_poll: HashMap<String, Instant> = HashMap::new();
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            loop {
                tokio::select! {
                    Some(root_id)=receiver.recv()=>{
                        if let Some(previous)=debounce.remove(&root_id){previous.abort();}
                        let delayed=state.clone();let id=root_id.clone();
                        let handle=tokio::spawn(async move {
                            let wait=delayed.db.root(&id).await.map(|r|r.debounce_ms).unwrap_or(1200);
                            tokio::time::sleep(Duration::from_millis(wait as u64)).await;
                            if let Err(error)=delayed.sync.sync_now(&id).await {tracing::debug!(root_id=%id,error=%error,"watcher sync pass did not complete");}
                        });
                        debounce.insert(root_id,handle);
                    }
                    _=interval.tick()=>{
                        let roots=match state.db.roots().await {Ok(roots)=>roots,Err(error)=>{tracing::error!(error=%error,"unable to list projects for scheduler");continue;}};
                        let now=Instant::now();
                        for root in roots.into_iter().filter(|root|root.enabled){
                            let retry_due=state.db.has_due_retry(&root.id).await.unwrap_or(false);
                            let due=retry_due||last_poll.get(&root.id).map(|last|now.duration_since(*last)>=Duration::from_secs(root.poll_interval_seconds.max(10) as u64)).unwrap_or(true);
                            if due {last_poll.insert(root.id.clone(),now);let sync=state.sync.clone();let id=root.id.clone();tokio::spawn(async move{if let Err(error)=sync.sync_now(&id).await{tracing::debug!(root_id=%id,error=%error,"scheduled sync pass did not complete");}});}
                            if let Err(error)=state.install_watcher(&root){tracing::warn!(root_id=%root.id,error=%error,"local watcher unavailable; periodic scans remain active");}
                        }
                    }
                    else=>break,
                }
            }
            let _ = app;
        });
    }

    pub async fn export_diagnostics(&self, destination: &std::path::Path) -> AppResult<()> {
        use std::{fs::File, io::Write};
        let history = self.db.history("", None, 100, 0).await?;
        let roots = self.db.roots().await?.into_iter().map(|root|serde_json::json!({
            "id":root.id,"remoteProjectId":root.remote_project_id,"accountId":root.account_id,
            "enabled":root.enabled,"status":root.status,"pollIntervalSeconds":root.poll_interval_seconds,
            "debounceMs":root.debounce_ms,"lastSyncAt":root.last_sync_at
        })).collect::<Vec<_>>();
        let accounts = self.db.accounts().await?.into_iter().map(|account|serde_json::json!({
            "id":account.id,"server":crate::webdav::redact_url(&account.url),"tlsVerify":account.tls_verify,
            "status":account.status,"capabilities":account.capabilities
        })).collect::<Vec<_>>();
        let history = history
            .into_iter()
            .map(|item| {
                serde_json::json!({
                    "id":item.id,"rootId":item.root_id,"action":item.action,"status":item.status,
                    "bytes":item.bytes,"timestamp":item.timestamp,"errorCode":item.error_code
                })
            })
            .collect::<Vec<_>>();
        let payload = serde_json::json!({"app":"ProjectSync","version":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"roots":roots,"accounts":accounts,"history":history});
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let path = destination.to_path_buf();
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            let file = File::create(&path)
                .map_err(|e| AppError::new("DIAGNOSTICS_EXPORT_FAILED", e.to_string()))?;
            let mut archive = zip::ZipWriter::new(file);
            archive
                .start_file(
                    "diagnostics.json",
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(|e| AppError::new("DIAGNOSTICS_EXPORT_FAILED", e.to_string()))?;
            archive
                .write_all(
                    serde_json::to_string_pretty(&payload)
                        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e.to_string()))?
                        .as_bytes(),
                )
                .map_err(|e| AppError::new("DIAGNOSTICS_EXPORT_FAILED", e.to_string()))?;
            archive
                .finish()
                .map_err(|e| AppError::new("DIAGNOSTICS_EXPORT_FAILED", e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::new("DIAGNOSTICS_EXPORT_FAILED", e.to_string()))??;
        Ok(())
    }
}

async fn prune_old_logs(directory: &std::path::Path, retention_days: u64) {
    let cutoff =
        std::time::SystemTime::now() - Duration::from_secs(retention_days.saturating_mul(86_400));
    let mut entries = match tokio::fs::read_dir(directory).await {
        Ok(entries) => entries,
        Err(error) => {
            tracing::warn!(error=%error,"unable to inspect log retention directory");
            return;
        }
    };
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(error) => {
                tracing::warn!(error=%error,"unable to continue log retention scan");
                break;
            }
        };
        let metadata = match entry.metadata().await {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.is_file()
            && metadata
                .modified()
                .ok()
                .is_some_and(|modified| modified < cutoff)
        {
            if let Err(error) = tokio::fs::remove_file(entry.path()).await {
                tracing::warn!(error=%error,"unable to remove expired log file");
            }
        }
    }
}
