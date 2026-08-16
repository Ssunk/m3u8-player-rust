use crate::parser;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use tauri::State;

/// 应用状态
pub struct AppState {
    pub data_dir: std::path::PathBuf,
}

// =========================================================================
// 数据结构
// =========================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDialogResult {
    pub path: String,
    pub url: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SimpleResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JavVideoResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vtt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JavSearchResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<parser::JavSearchItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// =========================================================================
// HTTP 请求辅助
// =========================================================================

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

fn build_jav_client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_default()
}

fn jav_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"),
    );
    headers.insert(
        "Accept-Language",
        HeaderValue::from_static("en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7"),
    );
    headers.insert(REFERER, HeaderValue::from_static("https://123av.com/"));
    headers
}

// =========================================================================
// 文件与对话框 Commands
// =========================================================================

#[tauri::command]
pub async fn open_file_dialog(window: tauri::Window) -> Option<FileDialogResult> {
    use tauri::api::dialog::blocking::FileDialogBuilder;

    let file_path = FileDialogBuilder::new()
        .add_filter("M3U8 Files", &["m3u8", "m3u"])
        .add_filter("All Files", &["*"])
        .set_parent(&window)
        .pick_file();

    if let Some(path) = file_path {
        let path_str = path.to_string_lossy().to_string();
        let content = fs::read_to_string(&path).unwrap_or_default();
        let file_url = format!("file:///{}", path_str.replace('\\', "/"));
        Some(FileDialogResult {
            path: path_str,
            url: file_url,
            content,
        })
    } else {
        None
    }
}

#[tauri::command]
pub async fn show_confirm_dialog(window: tauri::Window, message: String) -> bool {
    use tauri::api::dialog::{MessageDialogButtons, MessageDialogKind};
    use tauri::api::dialog::blocking::MessageDialogBuilder;

    MessageDialogBuilder::new("确认", &message)
        .kind(MessageDialogKind::Warning)
        .parent(&window)
        .buttons(MessageDialogButtons::OkCancel)
        .show()
}

#[tauri::command]
pub fn get_app_path(state: State<'_, AppState>) -> String {
    state.data_dir.to_string_lossy().to_string()
}

// =========================================================================
// 播放历史 Commands
// =========================================================================

fn play_history_path(state: &State<'_, AppState>) -> std::path::PathBuf {
    state.data_dir.join("play-history.json")
}

#[tauri::command]
pub fn get_play_history(state: State<'_, AppState>) -> Value {
    let path = play_history_path(&state);
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or(Value::Object(serde_json::Map::new()))
    } else {
        Value::Object(serde_json::Map::new())
    }
}

#[tauri::command]
pub fn save_play_history(
    state: State<'_, AppState>,
    url: String,
    time: f64,
    skip_intro: Option<f64>,
    skip_outro: Option<f64>,
) -> SimpleResult {
    let path = play_history_path(&state);
    let mut history: Value = if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or(Value::Object(serde_json::Map::new()))
    } else {
        Value::Object(serde_json::Map::new())
    };

    let mut entry = serde_json::Map::new();
    entry.insert("time".to_string(), Value::from(time));
    entry.insert(
        "timestamp".to_string(),
        Value::from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        ),
    );
    if let Some(si) = skip_intro {
        entry.insert("skipIntro".to_string(), Value::from(si));
    }
    if let Some(so) = skip_outro {
        entry.insert("skipOutro".to_string(), Value::from(so));
    }

    if let Value::Object(ref mut map) = history {
        map.insert(url, Value::Object(entry));
    }

    match fs::write(&path, serde_json::to_string_pretty(&history).unwrap_or_default()) {
        Ok(_) => SimpleResult { success: true, error: None },
        Err(e) => SimpleResult { success: false, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_play_history(state: State<'_, AppState>, url: String) -> SimpleResult {
    let path = play_history_path(&state);
    let mut history: Value = if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or(Value::Object(serde_json::Map::new()))
    } else {
        return SimpleResult { success: true, error: None };
    };

    if let Value::Object(ref mut map) = history {
        map.remove(&url);
    }

    match fs::write(&path, serde_json::to_string_pretty(&history).unwrap_or_default()) {
        Ok(_) => SimpleResult { success: true, error: None },
        Err(e) => SimpleResult { success: false, error: Some(e.to_string()) },
    }
}

// =========================================================================
// 全局设置 Commands
// =========================================================================

fn global_settings_path(state: &State<'_, AppState>) -> std::path::PathBuf {
    state.data_dir.join("global-settings.json")
}

#[tauri::command]
pub fn get_global_settings(state: State<'_, AppState>) -> Value {
    let path = global_settings_path(&state);
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_else(|_| {
            serde_json::json!({"skipIntro": 0, "skipOutro": 0})
        })
    } else {
        serde_json::json!({"skipIntro": 0, "skipOutro": 0})
    }
}

#[tauri::command]
pub fn save_global_settings(state: State<'_, AppState>, settings: Value) -> SimpleResult {
    let path = global_settings_path(&state);
    match fs::write(&path, serde_json::to_string_pretty(&settings).unwrap_or_default()) {
        Ok(_) => SimpleResult { success: true, error: None },
        Err(e) => SimpleResult { success: false, error: Some(e.to_string()) },
    }
}

// =========================================================================
// 播放列表 Commands
// =========================================================================

fn playlist_path(state: &State<'_, AppState>) -> std::path::PathBuf {
    state.data_dir.join("playlist.json")
}

#[tauri::command]
pub fn get_playlist(state: State<'_, AppState>) -> Value {
    let path = playlist_path(&state);
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or(Value::Array(vec![]))
    } else {
        Value::Array(vec![])
    }
}

#[tauri::command]
pub fn save_playlist(state: State<'_, AppState>, playlist: Value) -> SimpleResult {
    let path = playlist_path(&state);
    match fs::write(&path, serde_json::to_string_pretty(&playlist).unwrap_or_default()) {
        Ok(_) => SimpleResult { success: true, error: None },
        Err(e) => SimpleResult { success: false, error: Some(e.to_string()) },
    }
}

// =========================================================================
// 搜索历史 Commands
// =========================================================================

fn search_history_path(state: &State<'_, AppState>) -> std::path::PathBuf {
    state.data_dir.join("search-history.json")
}

#[tauri::command]
pub fn get_search_history(state: State<'_, AppState>) -> Value {
    let path = search_history_path(&state);
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or(Value::Array(vec![]))
    } else {
        Value::Array(vec![])
    }
}

#[tauri::command]
pub fn save_search_history(state: State<'_, AppState>, keyword: String) -> SimpleResult {
    let path = search_history_path(&state);
    let mut history: Vec<Value> = if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        vec![]
    };

    // 去重并移到最前面
    history.retain(|item| {
        item.get("keyword").and_then(|k| k.as_str()) != Some(&keyword)
    });
    history.insert(
        0,
        serde_json::json!({
            "keyword": keyword,
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        }),
    );

    // 只保留最近 20 条
    if history.len() > 20 {
        history.truncate(20);
    }

    match fs::write(&path, serde_json::to_string_pretty(&history).unwrap_or_default()) {
        Ok(_) => SimpleResult { success: true, error: None },
        Err(e) => SimpleResult { success: false, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn clear_search_history(state: State<'_, AppState>) -> SimpleResult {
    let path = search_history_path(&state);
    if path.exists() {
        match fs::remove_file(&path) {
            Ok(_) => SimpleResult { success: true, error: None },
            Err(e) => SimpleResult { success: false, error: Some(e.to_string()) },
        }
    } else {
        SimpleResult { success: true, error: None }
    }
}

// =========================================================================
// 影视搜索 Commands
// =========================================================================

#[tauri::command]
pub async fn search_resource(keyword: String, source: Option<String>) -> SearchResult {
    let encoded_keyword = urlencoding::encode(&keyword);
    let source = source.as_deref().unwrap_or("hongniu");
    let url = format!(
        "{}?ac=detail&wd={}",
        match source {
            "xigua" => "https://caiji.xgzyapi.com/api.php/provide/vod/from/xiguam3u8/",
            _ => "https://www.hongniuzy3.com/api.php/provide/vod/from/hnm3u8/",
        },
        encoded_keyword
    );

    let client = build_client();
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
    );

    match client.get(&url).headers(headers).send().await {
        Ok(response) => {
            let status = response.status();
            match response.text().await {
                Ok(body) => {
                    if !status.is_success() {
                        return SearchResult {
                            success: false,
                            results: None,
                            error: Some(format!("源站返回 HTTP {}", status)),
                        };
                    }
                    let parsed = parse_vod_json(&body);
                    match parsed {
                        Ok(results) if !results.is_empty() => SearchResult {
                            success: true,
                            results: Some(results),
                            error: None,
                        },
                        Ok(_) => SearchResult {
                            success: false,
                            results: None,
                            error: Some("未找到结果".to_string()),
                        },
                        Err(e) => SearchResult {
                            success: false,
                            results: None,
                            error: Some(format!("解析失败: {}", e)),
                        },
                    }
                }
                Err(e) => SearchResult {
                    success: false,
                    results: None,
                    error: Some(e.to_string()),
                },
            }
        }
        Err(e) => SearchResult {
            success: false,
            results: None,
            error: Some(e.to_string()),
        },
    }
}

fn parse_vod_json(body: &str) -> Result<Vec<Value>, String> {
    let data = serde_json::from_str::<Value>(body.trim_start_matches('\u{feff}').trim())
        .map_err(|e| e.to_string())?;
    Ok(data
        .get("list")
        .and_then(|l| l.as_array())
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    serde_json::json!({
                        "title": item.get("vod_name").and_then(|v| v.as_str()).unwrap_or(""),
                        "cover": item.get("vod_pic").and_then(|v| v.as_str()).unwrap_or(""),
                        "vodPlayUrl": item.get("vod_play_url").and_then(|v| v.as_str()).unwrap_or("")
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

// =========================================================================
// 小电影搜索 Commands (源2)
// =========================================================================

#[tauri::command]
pub async fn search_jav(keyword: String, page: Option<u32>) -> JavSearchResult {
    let safe_page = page.unwrap_or(1).max(1);
    let url = format!(
        "https://123av.com/cn/search?keyword={}&page={}",
        urlencoding::encode(&keyword),
        safe_page
    );

    let client = build_jav_client();
    let headers = jav_headers();

    match client.get(&url).headers(headers).send().await {
        Ok(response) => match response.text().await {
            Ok(body) => {
                let results = parser::parse_jav_search_result(&body);
                if results.is_empty() {
                    JavSearchResult {
                        success: false,
                        results: None,
                        error: Some("未找到结果".to_string()),
                    }
                } else {
                    JavSearchResult {
                        success: true,
                        results: Some(results),
                        error: None,
                    }
                }
            }
            Err(e) => JavSearchResult {
                success: false,
                results: None,
                error: Some(e.to_string()),
            },
        },
        Err(e) => JavSearchResult {
            success: false,
            results: None,
            error: Some(e.to_string()),
        },
    }
}


#[tauri::command]
pub async fn get_jav_video_url(video_url: String, cover: Option<String>) -> JavVideoResult {
    if !parser::is_trusted_jav_video_url(&video_url) {
        return JavVideoResult {
            success: false,
            stream: None,
            vtt: None,
            error: Some("非法的视频页面地址".to_string()),
        };
    }

    let client = build_jav_client();
    let headers = jav_headers();
    let _cover_str = cover.unwrap_or_default();

    // 1. 请求视频页面
    let page_response = match client.get(&video_url).headers(headers.clone()).send().await {
        Ok(r) => r,
        Err(e) => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some(e.to_string()),
            };
        }
    };

    let page_html = match page_response.text().await {
        Ok(t) => t,
        Err(e) => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some(e.to_string()),
            };
        }
    };

    // 2. 从 x-data="player(JSON.parse('...'))" 中提取转义前的 JSON
    let raw_json = match parser::extract_player_json(&page_html) {
        Some(j) => j,
        None => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some("未找到播放数据".to_string()),
            };
        }
    };

    // 3. JS 解转义得到实际 JSON 字符串
    let unescaped = parser::js_unescape(&raw_json);

    // 4. 解析 JSON 获取 episodes
    let episodes: Vec<Value> = match serde_json::from_str(&unescaped) {
        Ok(v) => v,
        Err(e) => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some(format!("解析播放数据失败: {}", e)),
            };
        }
    };

    // 5. 取第一个 episode 的 url
    let surrit_url = match episodes.first() {
        Some(ep) => ep.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()),
        None => None,
    };
    let surrit_url = match surrit_url {
        Some(u) => u,
        None => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some("播放链接无效".to_string()),
            };
        }
    };

    // 6. 从 surrit.store/e/{id} 中提取视频 ID
    let id_re = regex::Regex::new(r"/e/([A-Za-z0-9_]+)").unwrap();
    let video_id = match id_re.captures(&surrit_url) {
        Some(caps) => caps.get(1).unwrap().as_str().to_string(),
        None => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some("无法提取视频ID".to_string()),
            };
        }
    };

    // 7. 提取 poster 参数
    let poster = if let Ok(parsed) = url::Url::parse(&surrit_url) {
        parsed.query_pairs()
            .find(|(k, _)| k == "poster")
            .map(|(_, v)| v.to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    // 8. 直接请求 surrit.store/stream 获取媒体信息
    let media_url = format!(
        "https://surrit.store/stream?id={}&poster={}",
        urlencoding::encode(&video_id),
        urlencoding::encode(&poster)
    );

    let mut media_headers = jav_headers();
    media_headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json, text/plain, */*"),
    );

    let media_response = match client.get(&media_url).headers(media_headers).send().await {
        Ok(r) => r,
        Err(e) => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some(e.to_string()),
            };
        }
    };

    let media_body = match media_response.text().await {
        Ok(t) => t,
        Err(e) => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some(e.to_string()),
            };
        }
    };

    let media_json: Value = match serde_json::from_str(&media_body) {
        Ok(v) => v,
        Err(e) => {
            return JavVideoResult {
                success: false,
                stream: None,
                vtt: None,
                error: Some(format!("解析媒体数据失败: {}", e)),
            };
        }
    };

    // 9. 从 { status: "ok", media: { stream: "...", vtt: "..." } } 中提取
    let stream = media_json
        .get("media")
        .and_then(|m| m.get("stream"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    let vtt = media_json
        .get("media")
        .and_then(|m| m.get("vtt"))
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    if stream.is_none() {
        return JavVideoResult {
            success: false,
            stream: None,
            vtt: None,
            error: Some("未获取到流地址".to_string()),
        };
    }

    JavVideoResult {
        success: true,
        stream,
        vtt,
        error: None,
    }
}
