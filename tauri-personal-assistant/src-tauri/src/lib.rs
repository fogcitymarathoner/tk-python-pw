mod backup;
mod processes;

use processes::{AppId, AppLogs, AppStatus, ProcessManager};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{image::Image, menu::{Menu, MenuItem}, Manager, State};

#[tauri::command]
fn get_all_status(manager: State<'_, ProcessManager>) -> Vec<AppStatus> {
    manager.get_all_status()
}

#[tauri::command]
fn get_app_logs(app_id: String, manager: State<'_, ProcessManager>) -> Result<AppLogs, String> {
    let id = AppId::from_str(&app_id).ok_or_else(|| format!("Unknown app: {app_id}"))?;
    Ok(manager.get_logs(id))
}

#[tauri::command]
fn start_app(app_id: String, manager: State<'_, ProcessManager>) -> Result<(), String> {
    let id = AppId::from_str(&app_id).ok_or_else(|| format!("Unknown app: {app_id}"))?;
    manager.start(id)
}

#[tauri::command]
fn stop_app(app_id: String, manager: State<'_, ProcessManager>) -> Result<(), String> {
    let id = AppId::from_str(&app_id).ok_or_else(|| format!("Unknown app: {app_id}"))?;
    manager.stop(id)
}

#[tauri::command]
fn rebuild_app(app_id: String, manager: State<'_, ProcessManager>) -> Result<(), String> {
    let id = AppId::from_str(&app_id).ok_or_else(|| format!("Unknown app: {app_id}"))?;
    manager.rebuild(id)
}

#[tauri::command]
async fn backup_repo() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(backup::create_backup)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ProcessManager::new())
        .setup(|app| {
            let app_icon = Image::from_bytes(include_bytes!("../icons/tray.png"))
                .expect("failed to load app icon");

            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(app_icon.clone())?;
                #[cfg(windows)]
                apply_taskbar_icon(&window);
            }

            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::with_id("tray")
                .icon(app_icon.clone())
                .tooltip("Personal Assistant")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
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
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_status,
            get_app_logs,
            start_app,
            stop_app,
            rebuild_app,
            backup_repo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(windows)]
fn apply_taskbar_icon(window: &tauri::WebviewWindow) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_LOADFROMFILE, WM_SETICON,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let ico_path = std::env::temp_dir().join("tauri-personal-assistant.ico");
    if std::fs::write(&ico_path, include_bytes!("../icons/icon.ico")).is_err() {
        return;
    }

    let wide: Vec<u16> = ico_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let hwnd = hwnd.0;
        let small = LoadImageW(
            std::ptr::null_mut(),
            wide.as_ptr(),
            IMAGE_ICON,
            32,
            32,
            LR_LOADFROMFILE,
        );
        let big = LoadImageW(
            std::ptr::null_mut(),
            wide.as_ptr(),
            IMAGE_ICON,
            48,
            48,
            LR_LOADFROMFILE,
        );

        if !small.is_null() {
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL as usize, small as isize);
        }
        if !big.is_null() {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, big as isize);
        }
    }
}
