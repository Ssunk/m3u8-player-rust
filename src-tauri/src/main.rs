#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod config;
mod crypto;
mod parser;

use commands::AppState;
use config::{get_user_data_dir, load_window_state, save_window_state, WindowState};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = get_user_data_dir(&app.handle());
            // 确保数据目录存在
            let _ = std::fs::create_dir_all(&data_dir);

            let win_state = load_window_state(&data_dir);

            // 管理应用状态
            app.manage(AppState {
                data_dir: data_dir.clone(),
            });

            // 恢复窗口状态
            if let Some(window) = app.get_window("main") {
                if let (Some(x), Some(y)) = (win_state.x, win_state.y) {
                    let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                }
                let _ = window.set_size(tauri::PhysicalSize::new(
                    win_state.width as u32,
                    win_state.height as u32,
                ));
                if win_state.is_maximized {
                    let _ = window.maximize();
                }
            }

            Ok(())
        })
        .on_window_event(|event| {
            // 窗口关闭时保存状态
            if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
                let window = event.window();
                let app = window.app_handle();
                let data_dir = get_user_data_dir(&app);

                let is_maximized = window.is_maximized().unwrap_or(false);
                let size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(1200, 800));
                let position = window.outer_position().unwrap_or(tauri::PhysicalPosition::new(0, 0));

                let state = if is_maximized {
                    // 最大化时不保存尺寸和位置
                    let old = load_window_state(&data_dir);
                    WindowState {
                        is_maximized: true,
                        ..old
                    }
                } else {
                    WindowState {
                        width: size.width as f64,
                        height: size.height as f64,
                        x: Some(position.x as f64),
                        y: Some(position.y as f64),
                        is_maximized: false,
                    }
                };

                save_window_state(&data_dir, &state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file_dialog,
            commands::show_confirm_dialog,
            commands::get_app_path,
            commands::get_play_history,
            commands::save_play_history,
            commands::delete_play_history,
            commands::get_global_settings,
            commands::save_global_settings,
            commands::get_playlist,
            commands::save_playlist,
            commands::get_search_history,
            commands::save_search_history,
            commands::clear_search_history,
            commands::search_resource,
            commands::search_jav,
            commands::get_jav_video_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
