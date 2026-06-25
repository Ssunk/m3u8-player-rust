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

/// 从 HTML 中提取小电影搜索结果（123av.com）
pub fn parse_jav_search_result(html: &str) -> Vec<JavSearchItem> {
    let mut results = Vec::new();

    // 123av.com 使用 <div class="grid"> 包含 <div class="card"> 条目
    let grid_re = Regex::new(r#"<div class="grid">(.*?)</div>\s*<div class="pager""#).unwrap();
    let grid_html = match grid_re.captures(html) {
        Some(caps) => caps.get(1).map(|m| m.as_str()),
        None => return results,
    };
    let grid_html = match grid_html {
        Some(h) => h,
        None => return results,
    };

    // 每个卡片是一个 <div class="card">
    let card_re = Regex::new(r#"<div class="card"[^>]*>(.*?)</div>\s*</div>"#).unwrap();
    let href_re = Regex::new(r#"href="(/en/v/[^"]+)""#).unwrap();
    let cover_re = Regex::new(r#"<img[^>]*src="([^"]+)""#).unwrap();
    let title_re = Regex::new(r#"card__title"><a[^>]*>([^<]+)"#).unwrap();

    for caps in card_re.captures_iter(grid_html) {
        let card_html = caps.get(1).map(|m| m.as_str()).unwrap_or("");

        let href = href_re
            .captures(card_html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        let url = if !href.is_empty() {
            format!("https://123av.com{}", href)
        } else {
            continue;
        };

        let title = title_re
            .captures(card_html)
            .and_then(|c| c.get(1))
            .map(|m| {
                // 解码 HTML 实体
                let t = m.as_str().to_string();
                t.replace("&#039;", "'")
                    .replace("&amp;", "&")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&quot;", "\"")
            })
            .unwrap_or_default();

        let cover = cover_re
            .captures(card_html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        // 从 url slug 提取 id
        let id = href.split('/').last().unwrap_or("").to_string();

        results.push(JavSearchItem {
            id: if !id.is_empty() { id } else { format!("item_{}", results.len() + 1) },
            title: if !title.is_empty() { title } else { format!("Item {}", results.len() + 1) },
            cover,
            url,
            data_url: String::new(),
        });
    }

    results
}

/// 从视频详情页 HTML 中提取播放信息 JSON（123av.com）
/// 从 x-data="player(JSON.parse('...'))" 中提取 JS 转义前的 JSON 字符串
pub fn extract_player_json(html: &str) -> Option<String> {
    let re = Regex::new(r#"x-data="player\(JSON\.parse\('([^']+)'\)"#).unwrap();
    let caps = re.captures(html)?;
    let raw = caps.get(1)?.as_str();
    Some(raw.to_string())
}

/// JS 字符串解转义（供 extract_player_json 结果使用）
pub fn js_unescape(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('\\') => result.push('\\'),
                Some('/') => result.push('/'),
                Some('n') => result.push('\n'),
                Some('r') => result.push('\r'),
                Some('t') => result.push('\t'),
                Some('b') => result.push('\u{8}'),
                Some('f') => result.push('\u{c}'),
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    if let Ok(code) = u32::from_str_radix(&hex, 16) {
                        if let Some(ch) = char::from_u32(code) {
                            result.push(ch);
                        }
                    }
                }
                Some(c) => {
                    result.push('\\');
                    result.push(c);
                }
                None => result.push('\\'),
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// 检查是否是受信任的 JAV 视频 URL（123av.com）
pub fn is_trusted_jav_video_url(video_url: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(video_url) {
        parsed.scheme() == "https"
            && parsed.host_str() == Some("123av.com")
            && parsed.path().starts_with("/en/v/")
    } else {
        false
    }
}
