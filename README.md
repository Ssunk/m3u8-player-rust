# M3U8 Player

一个基于 Tauri v1 的 M3U8 流媒体视频桌面播放器，使用 Rust 后端 + 原生前端实现。

## 功能特性

- **M3U8/HLS 播放** — 支持本地文件和在线 M3U8 地址，拖拽文件即可播放
- **多源搜索** — 内置影视搜索和 JAV 搜索两个资源源，支持搜索缓存和历史记录
- **播放列表** — 管理播放队列，支持自动播放下一集
- **播放记忆** — 自动保存播放进度（每 15 秒），下次打开自动恢复
- **跳过片头/片尾** — 支持全局设置和单视频独立设置，自动跳过片头、片尾自动播放下一集
- **键盘快捷键** — 空格播放/暂停，方向键快进快退/调节音量，`f` 全屏，数字键跳转进度
- **窗口状态记忆** — 自动保存窗口位置和大小

## 快捷键

| 按键 | 功能 |
|------|------|
| `Space` / `K` | 播放 / 暂停 |
| `←` / `→` | 快退 / 快进 10 秒 |
| `↑` / `↓` | 音量增大 / 减小 |
| `F` | 全屏切换 |
| `M` | 静音切换 |
| `[` / `]` | 减速 / 加速播放 |
| `0-9` | 跳转到 0%-90% 进度 |

## 开发

### 环境要求

- Node.js
- Rust stable 工具链（通过 [rustup](https://rustup.rs/) 安装）
- Tauri v1 CLI：`npm install @tauri-apps/cli`

### 常用命令

```bash
npm run tauri:dev     # 开发模式运行
npm run tauri:build   # 构建安装包（输出到 src-tauri/target/release/bundle/）
```

### 项目结构

```
m3u8-player/
├── src/                        # 前端
│   ├── index.html              # 主界面
│   ├── player.js               # 播放器逻辑 + Tauri IPC 桥接
│   ├── styles.css              # 样式
│   └── vendor/hls.light.min.js # HLS 播放引擎
├── src-tauri/                  # Rust 后端
│   └── src/
│       ├── main.rs             # Tauri 入口：窗口管理、命令注册
│       ├── commands.rs         # IPC 命令处理器
│       ├── config.rs           # 窗口状态持久化
│       ├── crypto.rs           # JAV 源解密管线
│       └── parser.rs           # HTML 解析工具
├── main.js                     # [遗留] Electron 主进程
├── preload.js                  # [遗留] Electron preload
└── package.json
```

## 技术栈

- **前端**: 原生 HTML/CSS/JS + [hls.js](https://github.com/video-dev/hls.js)
- **后端**: Rust + [Tauri v1](https://tauri.app/)
- **HTTP**: reqwest（Rust）
- **数据持久化**: JSON 文件（存储在 `%APPDATA%/m3u8-player/`）

## License

MIT
