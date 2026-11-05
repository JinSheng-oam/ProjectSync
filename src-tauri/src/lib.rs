mod ai_scope;
mod app;
mod commands;
mod credentials;
mod domain;
mod filesystem;
mod security;
mod startup;
mod storage;
mod sync_engine;
mod webdav;

pub use app::AppState;
use tauri::Manager;

pub fn run() {
    let builder =
        commands::register_commands(tauri::Builder::default().plugin(tauri_plugin_dialog::init()));
    let builder_result = builder
        .setup(|app| {
            let state = tauri::async_runtime::block_on(AppState::initialize(app.handle()))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(state.clone());
            state.start_background(app.handle().clone());
            install_tray(app)?;
            if let Some(window) = app.get_webview_window("main") {
                let start_minimized = std::env::args().any(|arg| arg == "--start-minimized")
                    || tauri::async_runtime::block_on(state.db.setting("startMinimized"))
                        .ok()
                        .flatten()
                        .is_some_and(|value| value == "true");
                if start_minimized {
                    let _ = window.hide();
                }
                let closing_window = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = closing_window.hide();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(error) = builder_result {
        eprintln!("ProjectSync Tauri runtime failed: {error}");
    }
}

fn install_tray(app: &mut tauri::App<tauri::Wry>) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        Manager,
    };
    let show = MenuItem::with_id(app, "show", "打开 ProjectSync", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause_all", "暂停所有项目", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume_all", "立即同步所有项目", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 ProjectSync", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &pause, &resume, &separator, &quit])?;
    let icon =
        tauri::image::Image::from_bytes(include_bytes!("../icons/projectsync-v2/32x32.png"))?;
    TrayIconBuilder::with_id("projectsync-main")
        .tooltip("ProjectSync")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            "pause_all" => {
                if let Some(state) = app.try_state::<AppState>() {
                    let state = state.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        if let Ok(roots) = state.db.roots().await {
                            for root in roots.into_iter().filter(|root| root.enabled) {
                                let _ = state.sync.pause(&root.id).await;
                            }
                        }
                    });
                }
            }
            "resume_all" => {
                if let Some(state) = app.try_state::<AppState>() {
                    let state = state.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        if let Ok(roots) = state.db.roots().await {
                            for root in roots {
                                if root.enabled {
                                    let _ = state.sync.resume(&root.id).await;
                                }
                            }
                        }
                    });
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
