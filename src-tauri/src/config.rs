use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 窗口状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    #[serde(rename = "isMaximized", default)]
    pub is_maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1200.0,
            height: 800.0,
            x: None,
            y: None,
            is_maximized: false,
        }
    }
}

/// 获取用户数据目录
pub fn get_user_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path_resolver()
        .app_data_dir()
        .unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("m3u8-player")
        })
}

/// 加载窗口状态
pub fn load_window_state(data_dir: &PathBuf) -> WindowState {
    let state_path = data_dir.join("window-state.json");
    if let Ok(data) = fs::read_to_string(&state_path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        WindowState::default()
    }
}

/// 保存窗口状态
pub fn save_window_state(data_dir: &PathBuf, state: &WindowState) {
    let state_path = data_dir.join("window-state.json");
    let _ = fs::write(&state_path, serde_json::to_string(state).unwrap_or_default());
}
