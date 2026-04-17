# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

M3U8 Player 是一个 M3U8 流媒体视频桌面播放器。已从 Electron 迁移至 **Tauri v1**，后端用 Rust 实现，前端为原生 HTML/CSS/JS（无框架），使用 hls.js 进行 HLS 播放。

## Commands

```bash
npm run tauri:dev     # 开发模式运行（需要 Rust 工具链）
npm run tauri:build   # 构建安装包（输出到 src-tauri/target/release/bundle/）
cargo test -p m3u8-player  # 运行 Rust 后端测试（在 src-tauri/ 目录下）
```

前置条件：Node.js + Rust stable 工具链（rustup）+ Tauri v1 CLI（`@tauri-apps/cli`）。

## Architecture

### 整体结构

```
m3u8-player/
├── src/                    # 前端（Tauri 加载的静态资源）
│   ├── index.html          # 主 UI
│   ├── player.js           # M3U8Player 类 + Tauri API 桥接层（tauriAPI）
│   ├── styles.css          # 样式
│   └── vendor/hls.light.min.js
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs         # Tauri 入口：窗口管理、状态初始化、事件处理、命令注册
│   │   ├── commands.rs     # 所有 Tauri commands（IPC 处理器）
│   │   ├── config.rs       # WindowState 序列化 + 数据目录管理
│   │   ├── crypto.rs       # JAV 源的解密管线：simpleDecrypt / lEncrypt / decodeMedia
│   │   └── parser.rs       # HTML 解析：搜索结果提取、URL 白名单校验
│   ├── Cargo.toml
│   └── tauri.conf.json     # Tauri 配置（窗口、CSP、权限白名单）
├── main.js                 # [遗留] Electron 主进程，已不使用
├── preload.js              # [遗留] Electron preload，已不使用
└── package.json
```

### 前后端通信

前端通过 `window.__TAURI__.tauri.invoke()` 调用 Rust 后端的 `#[tauri::command]` 函数。`player.js` 顶部的 `tauriAPI` 对象封装了所有 IPC 调用，参数使用 camelCase，Tauri 自动转换为 Rust 的 snake_case 参数名。

### Rust 后端模块

- **commands.rs** — 所有 Tauri command 处理器。共享状态通过 `AppState`（`data_dir`）注入。HTTP 请求使用 `reqwest`。
- **config.rs** — `WindowState` 的加载/保存。数据目录通过 Tauri 的 `path_resolver().app_data_dir()` 确定。
- **crypto.rs** — JAV 源的解密管线：`simple_decrypt`（Base64 + XOR）→ `l_encrypt`（XOR + Base64 生成 token）→ `decode_media`（Base64 + XOR + URL decode + JSON parse）。
- **parser.rs** — HTML 解析工具：`parse_jav_search_result` 解析搜索结果页，`is_trusted_jav_video_url` 校验 URL 白名单。

### Search Sources

**源 1（影视）**: 直连 `api.ffzyapi.com`，返回 vod 列表。播放地址直接从 `vod_play_url` 字段解析，无需额外解密。

**源 2（JAV）**: 请求 `javxx.com` 搜索页 → 解析 HTML 获取条目 → 请求视频页提取 `data-url` → 解密管线获取流地址。解密流程涉及 `crypto.rs` 的三步处理。

### Data Persistence

所有数据存储在 Tauri 的 `appDataDir` 目录下（Windows: `%APPDATA%/m3u8-player/`）：

- `play-history.json` — 播放进度 + 每个视频的跳过设置
- `playlist.json` — 用户播放列表
- `search-history.json` — 搜索历史（最多 20 条）
- `global-settings.json` — 全局跳过设置（片头/片尾秒数）
- `window-state.json` — 窗口位置和尺寸

### IPC Commands

| 命令 | 用途 |
|------|------|
| `open_file_dialog` | 打开 .m3u8/.m3u 文件选择器 |
| `show_confirm_dialog` | 确认对话框 |
| `get_app_path` | 返回数据目录路径 |
| `search_resource` | 影视搜索 |
| `search_jav` | JAV 搜索（分页） |
| `get_jav_video_url` | JAV 视频流地址（含解密管线） |
| `get_play_history` / `save_play_history` / `delete_play_history` | 播放历史（每 15s 自动保存） |
| `get_playlist` / `save_playlist` | 播放列表 |
| `get_global_settings` / `save_global_settings` | 全局跳过设置 |
| `get_search_history` / `save_search_history` / `clear_search_history` | 搜索历史 |

## Notes

- `main.js`、`preload.js`、`search.js` 是 Electron 遗留文件，Tauri 版本不使用它们。`src/player.js` 同时包含 Tauri API 桥接和播放器逻辑。
- 搜索缓存使用 localStorage，key 格式：`search_v2_{keyword}`（影视）、`jav_{keyword}_{page}`（JAV），有效期 24 小时。
- 拖拽文件播放通过 Tauri 的 `fileDropEnabled` 配置 + 前端 `drop` 事件实现。
- 窗口关闭时自动保存位置/尺寸（`on_window_event` → `CloseRequested`）。
- `tauri.conf.json` 的 CSP 策略限制了脚本来源为 `'self'`，媒体和图片允许 `https: http: blob:`。
