use regex::Regex;
use serde::{Deserialize, Serialize};

/// JAV 搜索结果项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavSearchItem {
    pub id: String,
    pub title: String,
    pub cover: String,
    pub url: String,
    #[serde(rename = "dataUrl")]
    pub data_url: String,
}

/// 从 HTML 中提取小电影搜索结果
/// 对应 JS 中的 parseJavSearchResult 函数
pub fn parse_jav_search_result(html: &str) -> Vec<JavSearchItem> {
    let mut results = Vec::new();

    // 按 class="item" 分割 HTML，每段对应一个条目
    let parts: Vec<&str> = html.split("class=\"item\"").collect();

    let href_re = Regex::new(r#"href="(/cn/v/[^"]+)""#).unwrap();
    let cover_re = Regex::new(r#"src="([^"]+\.webp)""#).unwrap();
    let data_url_re = Regex::new(r#"data-url="([^"]+)""#).unwrap();

    // 跳过第一段（class="item" 之前的内容）
    for (i, part) in parts.iter().enumerate().skip(1) {
        // 提取视频链接 href
        let href = href_re
            .captures(part)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        let url = if !href.is_empty() {
            format!("https://javxx.com{}", href)
        } else {
            String::new()
        };

        // 提取标题 - 从 href 最后部分
        let title = if !href.is_empty() {
            href.split('/').last().unwrap_or("").to_string()
        } else {
            String::new()
        };

        // 提取 webp 封面图
        let cover = cover_re
            .captures(part)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        // 提取 data-url
        let data_url = data_url_re
            .captures(part)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        if !url.is_empty() || !title.is_empty() {
            results.push(JavSearchItem {
                id: if !title.is_empty() { title.clone() } else { format!("item_{}", i) },
                title: if !title.is_empty() { title } else { format!("Item {}", i) },
                cover,
                url,
                data_url,
            });
        }
    }

    results
}

/// 从 item HTML 中提取 data-url
fn extract_data_url(item_html: &str) -> String {
    Regex::new(r#"data-url="([^"]+)""#)
        .ok()
        .and_then(|re| re.captures(item_html))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default()
}

/// 从 HTML 中提取 _obj.player JSON 数据
/// 对应 JS 中 get-m3u8-url 的解析逻辑
pub fn extract_player_url(html: &str) -> Option<String> {
    let re = Regex::new(r#"_obj\.player\s*=\s*(\{.*?\});"#).ok()?;
    let caps = re.captures(html)?;
    let json_str = caps.get(1)?.as_str();
    let player_data: serde_json::Value = serde_json::from_str(json_str).ok()?;
    player_data.get("url")?.as_str().map(|s| s.to_string())
}

/// 检查是否是受信任的 JAV 视频 URL
pub fn is_trusted_jav_video_url(video_url: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(video_url) {
        parsed.scheme() == "https"
            && parsed.host_str() == Some("javxx.com")
            && parsed.path().starts_with("/cn/v/")
    } else {
        false
    }
}
