// Tauri API 桥接层 - 替代 Electron 的 preload.js
// 使用 Tauri 的 invoke 调用 Rust 后端命令
const { invoke } = window.__TAURI__.tauri;

const tauriAPI = {
  openFile: () => invoke('open_file_dialog'),
  showConfirmDialog: (message) => invoke('show_confirm_dialog', { message }),
  getAppPath: () => invoke('get_app_path'),
  // 影视搜索源
  searchResource: (keyword, source) => invoke('search_resource', { keyword, source }),
  // 小电影搜索（源2）
  searchJav: (keyword, page) => invoke('search_jav', { keyword, page }),
  getJavVideoUrl: (videoUrl, cover) => invoke('get_jav_video_url', { videoUrl, cover }),
  // 播放记录
  getPlayHistory: () => invoke('get_play_history'),
  savePlayHistory: (url, time, skipIntro, skipOutro) => invoke('save_play_history', { url, time, skipIntro, skipOutro }),
  deletePlayHistory: (url) => invoke('delete_play_history', { url }),
  // 播放列表
  getPlaylist: () => invoke('get_playlist'),
  savePlaylist: (playlist) => invoke('save_playlist', { playlist }),
  // 全局跳过设置
  getGlobalSettings: () => invoke('get_global_settings'),
  saveGlobalSettings: (settings) => invoke('save_global_settings', { settings }),
  // 搜索历史
  getSearchHistory: () => invoke('get_search_history'),
  saveSearchHistory: (keyword) => invoke('save_search_history', { keyword }),
  clearSearchHistory: () => invoke('clear_search_history'),
};

class M3U8Player {
  constructor() {
    this.hls = null;
    this.playlist = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isMuted = false;
    this.volume = 1;

    // 搜索缓存配置
    this.searchCache = {
      prefix: 'search_v3_',
      expire: 24 * 60 * 60 * 1000 // 24小时
    };
    this.movieSources = [
      { id: 'hongniu', name: '红牛' },
      { id: 'xigua', name: '西瓜' }
    ];
    this.movieSourceResults = {};
    this.movieSourceCacheState = {};
    this.currentMovieKeyword = '';
    this.currentMovieSource = 'hongniu';

    // 搜索历史
    this.searchHistory = [];

    // 播放历史
    this.playHistory = {};
    this.currentPlayingUrl = '';
    this.saveInterval = null;
    this.autoSaveIntervalMs = 15000;
    this.nativeLoadedMetadataHandler = null;

    // 跳过设置
    this.globalSettings = { skipIntro: 0, skipOutro: 0 };
    this.currentSkipIntro = 0;
    this.currentSkipOutro = 0;
    this.hasSkippedIntro = false;

    this.initElements();
    this.initEventListeners();
    this.initDragDrop();

    // 加载设置和历史
    this.loadPlayHistory();
    this.loadGlobalSettings();
    this.loadPlaylist();
    this.loadSearchHistory();
  }

  // 加载全局跳过设置
  async loadGlobalSettings() {
    try {
      const settings = await tauriAPI.getGlobalSettings();
      this.globalSettings = {
        skipIntro: settings.skipIntro || 0,
        skipOutro: settings.skipOutro || 0
      };
    } catch (e) {
      console.error('Failed to load global settings:', e);
    }
  }

  // 保存全局跳过设置
  async saveGlobalSettings() {
    try {
      await tauriAPI.saveGlobalSettings(this.globalSettings);
    } catch (e) {
      console.error('Failed to save global settings:', e);
    }
  }

  // 加载搜索历史
  async loadSearchHistory() {
    try {
      this.searchHistory = await tauriAPI.getSearchHistory();
      this.renderSearchHistory();
    } catch (e) {
      console.error('Failed to load search history:', e);
    }
  }

  // 保存搜索历史
  async saveSearchHistory(keyword) {
    if (!keyword) return;
    try {
      await tauriAPI.saveSearchHistory(keyword);
      this.searchHistory = await tauriAPI.getSearchHistory();
      this.renderSearchHistory();
    } catch (e) {
      console.error('Failed to save search history:', e);
    }
  }

  // 清除搜索历史
  async clearSearchHistory() {
    try {
      const confirmed = await tauriAPI.showConfirmDialog('确定要清空搜索历史吗？');
      if (!confirmed) return;
      await tauriAPI.clearSearchHistory();
      this.searchHistory = [];
      this.renderSearchHistory();
    } catch (e) {
      console.error('Failed to clear search history:', e);
    }
  }

  // 删除单条搜索历史
  async deleteSearchHistoryItem(keyword) {
    try {
      this.searchHistory = this.searchHistory.filter(item => item.keyword !== keyword);
      await tauriAPI.clearSearchHistory();
      for (const item of this.searchHistory) {
        await tauriAPI.saveSearchHistory(item.keyword);
      }
      this.renderSearchHistory();
    } catch (e) {
      console.error('Failed to delete search history item:', e);
    }
  }

  // 渲染搜索历史
  renderSearchHistory() {
    if (!this.searchHistoryItems) return;
    this.searchHistoryItems.replaceChildren();

    if (!this.searchHistory || this.searchHistory.length === 0) {
      this.searchHistoryPanel?.classList.remove('visible');
      const empty = document.createElement('div');
      empty.className = 'search-history-empty';
      empty.textContent = '暂无搜索历史';
      this.searchHistoryItems.appendChild(empty);
      return;
    }

    this.searchHistoryPanel?.classList.add('visible');

    this.searchHistory.forEach((item) => {
      const historyItem = document.createElement('div');
      historyItem.className = 'search-history-item';

      const text = document.createElement('span');
      text.className = 'search-history-text';
      text.textContent = item.keyword;

      const deleteBtn = document.createElement('span');
      deleteBtn.className = 'search-history-delete';
      deleteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSearchHistoryItem(item.keyword);
      });

      historyItem.appendChild(text);
      historyItem.appendChild(deleteBtn);

      historyItem.addEventListener('click', () => {
        this.searchInput.value = item.keyword;
        this.doSearch();
      });

      this.searchHistoryItems.appendChild(historyItem);
    });
  }

  // 加载播放历史
  async loadPlayHistory() {
    try {
      this.playHistory = await tauriAPI.getPlayHistory();
    } catch (e) {
      console.error('Failed to load play history:', e);
    }
  }

  // 加载播放列表
  async loadPlaylist() {
    try {
      const savedPlaylist = await tauriAPI.getPlaylist();
      if (savedPlaylist && savedPlaylist.length > 0) {
        this.playlist = savedPlaylist;
        this.renderPlaylist();
      }
    } catch (e) {
      console.error('Failed to load playlist:', e);
    }
  }

  // 保存播放列表
  async savePlaylist() {
    try {
      await tauriAPI.savePlaylist(this.playlist);
    } catch (e) {
      console.error('Failed to save playlist:', e);
    }
  }

  // 开始自动保存进度
  startAutoSave(url) {
    this.currentPlayingUrl = url;
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.saveInterval = window.setInterval(() => {
      this.saveCurrentProgress().catch((error) => {
        console.error('Failed to auto-save progress:', error);
      });
    }, this.autoSaveIntervalMs);
  }

  // 保存当前进度
  async saveCurrentProgress() {
    if (!this.currentPlayingUrl || !this.video || this.video.paused) return;
    try {
      const currentTime = this.video.currentTime;
      const history = this.playHistory[this.currentPlayingUrl] || {};
      await tauriAPI.savePlayHistory(
        this.currentPlayingUrl,
        currentTime,
        history.skipIntro,
        history.skipOutro
      );
      this.playHistory[this.currentPlayingUrl] = {
        time: currentTime,
        timestamp: Date.now(),
        skipIntro: history.skipIntro,
        skipOutro: history.skipOutro
      };
    } catch (e) {
      console.error('Failed to save progress:', e);
    }
  }

  // 保存跳过设置到播放历史
  async saveSkipSettingsToHistory(intro, outro) {
    if (!this.currentPlayingUrl) return;
    try {
      const currentTime = this.video.currentTime || 0;
      await tauriAPI.savePlayHistory(
        this.currentPlayingUrl,
        currentTime,
        intro,
        outro
      );
      this.playHistory[this.currentPlayingUrl] = {
        time: currentTime,
        timestamp: Date.now(),
        skipIntro: intro,
        skipOutro: outro
      };
    } catch (e) {
      console.error('Failed to save skip settings:', e);
    }
  }

  // 获取上次播放进度
  getLastPlayTime(url) {
    return this.playHistory[url]?.time || 0;
  }

  // 获取视频的跳过设置
  getSkipSettings(url) {
    const history = this.playHistory[url] || {};
    return {
      intro: history.skipIntro !== undefined ? history.skipIntro : this.globalSettings.skipIntro,
      outro: history.skipOutro !== undefined ? history.skipOutro : this.globalSettings.skipOutro
    };
  }

  // 解析时间输入（支持 90、1:30、01:30:00 格式）
  parseTimeInput(input) {
    if (!input || input.trim() === '') return 0;
    const trimmed = input.trim();

    // 纯数字，直接作为秒数
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }

    // 分:秒 或 时:分:秒 格式
    const parts = trimmed.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return 0;
  }

  // 将秒数转换为 MM:SS 格式显示
  formatTimeOutput(seconds) {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  initElements() {
    this.video = document.getElementById('videoPlayer');
    this.urlInput = document.getElementById('urlInput');
    this.loadBtn = document.getElementById('loadBtn');
    this.openFileBtn = document.getElementById('openFileBtn');
    this.playPauseBtn = document.getElementById('playPauseBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.volumeBtn = document.getElementById('volumeBtn');
    this.volumeSlider = document.getElementById('volumeSlider');
    this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.playlistToggleBtn = document.getElementById('playlistToggleBtn');
    this.playlistPanel = document.getElementById('playlistPanel');
    this.playlistItems = document.getElementById('playlistItems');
    this.addUrlBtn = document.getElementById('addUrlBtn');
    this.clearPlaylistBtn = document.getElementById('clearPlaylistBtn');
    this.progressBar = document.getElementById('progressBar');
    this.progressBuffered = document.getElementById('progressBuffered');
    this.progressPlayed = document.getElementById('progressPlayed');
    this.progressHoverTime = document.getElementById('progressHoverTime');
    this.currentTimeEl = document.getElementById('currentTime');
    this.durationEl = document.getElementById('duration');
    this.titleDisplay = document.getElementById('titleDisplay');
    this.videoOverlay = document.getElementById('videoOverlay');
    this.loadingSpinner = document.getElementById('loadingSpinner');
    this.errorMessage = document.getElementById('errorMessage');
    this.controlsBar = document.getElementById('controlsBar');
    this.speedSelect = document.getElementById('speedSelect');

    // 搜索相关元素
    this.searchPanel = document.getElementById('searchPanel');
    this.searchInput = document.getElementById('searchInput');
    this.searchResults = document.getElementById('searchResults');
    this.searchSourceSelect = document.getElementById('searchSource');
    this.searchHistoryPanel = document.getElementById('searchHistory');
    this.searchHistoryItems = document.getElementById('searchHistoryItems');
    this.clearSearchHistoryBtn = document.getElementById('clearSearchHistoryBtn');

    // 跳过设置相关元素
    this.skipSettingsBtn = document.getElementById('skipSettingsBtn');
    this.skipSettingsModal = document.getElementById('skipSettingsModal');
    this.skipIntroInput = document.getElementById('skipIntroInput');
    this.skipOutroInput = document.getElementById('skipOutroInput');
    this.setAsDefaultCheckbox = document.getElementById('setAsDefault');
    this.saveSkipSettingsBtn = document.getElementById('saveSkipSettings');
    this.cancelSkipSettingsBtn = document.getElementById('cancelSkipSettings');

    // 存储当前资源的 playlist
    this.currentPlaylist = null;
    this.currentResourceTitle = '';
    this.currentJavResults = null;
  }

  initEventListeners() {
    // 加载按钮
    this.loadBtn.addEventListener('click', () => {
      const url = this.urlInput.value.trim();
      if (url) {
        this.loadSource(url);
      }
    });

    this.urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const url = this.urlInput.value.trim();
        if (url) {
          this.loadSource(url);
        }
      }
    });

    // 打开文件
    this.openFileBtn.addEventListener('click', async () => {
      try {
        const result = await tauriAPI.openFile();
        if (result) {
          this.urlInput.value = result.url;
          this.loadSource(result.url);
        }
      } catch (e) {
        console.error('Failed to open file:', e);
      }
    });

    // 播放/暂停
    this.playPauseBtn.addEventListener('click', () => this.togglePlay());

    // 停止
    this.stopBtn.addEventListener('click', () => this.stop());

    // 音量
    this.volumeBtn.addEventListener('click', () => this.toggleMute());
    this.volumeSlider.addEventListener('input', (e) => {
      this.setVolume(e.target.value);
    });

    // 全屏
    this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

    // 播放列表
    this.playlistToggleBtn.addEventListener('click', () => this.togglePlaylist());
    this.addUrlBtn.addEventListener('click', () => this.showAddUrlModal());
    this.clearPlaylistBtn.addEventListener('click', () => this.clearPlaylist());

    // 跳过设置
    this.skipSettingsBtn.addEventListener('click', () => this.showSkipSettings());
    this.saveSkipSettingsBtn.addEventListener('click', () => this.applySkipSettings());
    this.cancelSkipSettingsBtn.addEventListener('click', () => this.hideSkipSettings());

    // 点击弹窗外部关闭
    this.skipSettingsModal.addEventListener('click', (e) => {
      if (e.target === this.skipSettingsModal) {
        this.hideSkipSettings();
      }
    });

    // 速度选择
    this.speedSelect.addEventListener('change', (e) => {
      this.setSpeed(e.target.value);
    });

    // 页面关闭前保存播放进度
    window.addEventListener('beforeunload', () => {
      this.saveCurrentProgress();
    });

    // 搜索功能 - 回车搜索
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.doSearch();
      }
    });

    // 搜索历史事件
    this.clearSearchHistoryBtn?.addEventListener('click', () => this.clearSearchHistory());

    // 进度条点击和拖动
    this.progressBar.addEventListener('click', (e) => this.seekTo(e));
    this.progressBar.addEventListener('mousemove', (e) => this.updateProgressHover(e));
    this.progressBar.addEventListener('mouseleave', () => this.hideProgressHover());

    // 拖动支持
    this.isDraggingProgress = false;
    this.progressBar.addEventListener('mousedown', (e) => {
      this.isDraggingProgress = true;
      this.updateProgressHover(e);
      this.seekTo(e);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isDraggingProgress) {
        this.updateProgressHover(e);
        this.seekTo(e);
      }
    });

    document.addEventListener('mouseup', () => {
      this.isDraggingProgress = false;
      this.hideProgressHover();
    });

    // 视频事件
    this.video.addEventListener('play', () => this.onPlay());
    this.video.addEventListener('pause', () => this.onPause());
    this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.video.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
    this.video.addEventListener('progress', () => this.onProgress());
    this.video.addEventListener('waiting', () => this.showLoading());
    this.video.addEventListener('canplay', () => this.hideLoading());
    this.video.addEventListener('error', () => this.onError());

    // 键盘快捷键
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    // 鼠标移动显示/隐藏控制栏
    let controlsTimeout;
    this.video.addEventListener('mousemove', () => {
      this.controlsBar.style.opacity = '1';
      clearTimeout(controlsTimeout);
      controlsTimeout = setTimeout(() => {
        if (this.isPlaying) {
          this.controlsBar.style.opacity = '0.7';
        }
      }, 3000);
    });
  }

  initDragDrop() {
    // Tauri 文件拖拽事件
    if (window.__TAURI__?.event) {
      window.__TAURI__.event.listen('tauri://file-drop', (event) => {
        const files = event.payload;
        if (files && files.length > 0) {
          const filePath = files[0];
          if (filePath.endsWith('.m3u8') || filePath.endsWith('.m3u')) {
            const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
            this.urlInput.value = fileUrl;
            this.loadSource(fileUrl);
          }
        }
      });
    }

    // 防止默认拖拽行为
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  // 显示跳过设置弹窗
  showSkipSettings() {
    const settings = this.getSkipSettings(this.currentPlayingUrl);
    this.skipIntroInput.value = this.formatTimeOutput(settings.intro) || '';
    this.skipOutroInput.value = this.formatTimeOutput(settings.outro) || '';
    this.setAsDefaultCheckbox.checked = false;
    this.skipSettingsModal.classList.add('visible');
    this.skipIntroInput.focus();
  }

  // 隐藏跳过设置弹窗
  hideSkipSettings() {
    this.skipSettingsModal.classList.remove('visible');
  }

  // 应用跳过设置
  async applySkipSettings() {
    const intro = this.parseTimeInput(this.skipIntroInput.value);
    const outro = this.parseTimeInput(this.skipOutroInput.value);

    // 更新当前视频设置
    this.currentSkipIntro = intro;
    this.currentSkipOutro = outro;
    this.hasSkippedIntro = false;

    // 保存到播放历史
    await this.saveSkipSettingsToHistory(intro, outro);

    // 如果勾选设为默认，更新全局设置
    if (this.setAsDefaultCheckbox.checked) {
      this.globalSettings.skipIntro = intro;
      this.globalSettings.skipOutro = outro;
      await this.saveGlobalSettings();
    }

    this.hideSkipSettings();

    // 如果当前正在播放且需要跳过片头，立即跳过
    if (this.isPlaying && this.currentSkipIntro > 0) {
      const currentTime = this.video.currentTime;
      if (currentTime < this.currentSkipIntro && currentTime < 5) {
        this.video.currentTime = this.currentSkipIntro;
        this.hasSkippedIntro = true;
      }
    }
  }

  loadSource(url, options = {}) {
    this.destroyHls();
    this.hideError();

    // 停止之前的自动保存
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    // 重置跳过状态
    this.hasSkippedIntro = false;

    // 添加到播放列表
    const title = options.title || this.extractTitle(url);
    this.addToPlaylist({ url, title });
    this.currentIndex = this.playlist.findIndex(item => item.url === url);
    this.renderPlaylist();

    this.titleDisplay.textContent = title;

    // 开始自动保存播放进度
    this.startAutoSave(url);

    // 获取上次播放位置和跳过设置
    const lastTime = this.getLastPlayTime(url);
    const skipSettings = this.getSkipSettings(url);
    this.currentSkipIntro = skipSettings.intro;
    this.currentSkipOutro = skipSettings.outro;

    if (Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false
      });

      this.hls.loadSource(url);
      this.hls.attachMedia(this.video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log('Manifest loaded:', data);
        const resumeTime = Math.max(lastTime, this.currentSkipIntro);
        if (resumeTime > 0 && resumeTime < (this.video.duration || Infinity)) {
          this.video.currentTime = resumeTime;
          this.hasSkippedIntro = true;
        }
        this.video.play().catch(err => console.log('Auto play failed:', err));
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              this.showError('网络错误，尝试恢复...');
              this.hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              this.showError('媒体错误，尝试恢复...');
              this.hls.recoverMediaError();
              break;
            default:
              this.destroyHls();
              this.showError('播放错误: ' + data.type);
              break;
          }
        }
      });

    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = url;
      this.nativeLoadedMetadataHandler = () => {
        const resumeTime = Math.max(lastTime, this.currentSkipIntro);
        if (resumeTime > 0 && resumeTime < (this.video.duration || Infinity)) {
          this.video.currentTime = resumeTime;
          this.hasSkippedIntro = true;
        }
        this.video.play().catch(err => console.log('Auto play failed:', err));
      };
      this.video.addEventListener('loadedmetadata', this.nativeLoadedMetadataHandler, { once: true });
    } else {
      this.showError('您的浏览器不支持 HLS 播放');
    }
  }

  destroyHls() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.nativeLoadedMetadataHandler) {
      this.video.removeEventListener('loadedmetadata', this.nativeLoadedMetadataHandler);
      this.nativeLoadedMetadataHandler = null;
    }
  }

  // 播放控制
  togglePlay() {
    if (this.video.paused) {
      this.video.play();
    } else {
      this.video.pause();
    }
  }

  stop() {
    // 保存当前播放进度
    this.saveCurrentProgress();
    // 停止自动保存
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    this.currentPlayingUrl = '';

    this.video.pause();
    this.video.currentTime = 0;
    this.video.src = '';
    this.destroyHls();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.video.muted = this.isMuted;
    this.volumeBtn.classList.toggle('muted', this.isMuted);
    this.volumeSlider.value = this.isMuted ? 0 : this.volume;
  }

  setVolume(value) {
    this.volume = value;
    this.video.volume = value;
    this.video.muted = value === 0;
    this.isMuted = value === 0;
    this.volumeBtn.classList.toggle('muted', this.isMuted);
  }

  setSpeed(value) {
    this.video.playbackRate = parseFloat(value);
  }

  adjustSpeed(delta) {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    let currentSpeed = this.video.playbackRate;
    let newSpeed = currentSpeed + delta;

    newSpeed = Math.max(0.5, Math.min(2, newSpeed));

    let closest = speeds.reduce((prev, curr) =>
      Math.abs(curr - newSpeed) < Math.abs(prev - newSpeed) ? curr : prev
    );

    this.video.playbackRate = closest;
    this.speedSelect.value = closest.toString();
  }

  seekTo(e) {
    const percent = this.getProgressPercent(e);
    const time = percent * this.video.duration;
    if (!isNaN(time)) {
      this.video.currentTime = time;
    }
  }

  getProgressPercent(e) {
    const rect = this.progressBar.getBoundingClientRect();
    if (!rect.width) return 0;
    const rawPercent = (e.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, rawPercent));
  }

  updateProgressHover(e) {
    if (!this.progressHoverTime) return;
    const duration = this.video.duration || 0;
    if (!duration) {
      this.hideProgressHover();
      return;
    }

    const percent = this.getProgressPercent(e);
    const hoverTime = percent * duration;
    this.progressHoverTime.textContent = this.formatTime(hoverTime);
    this.progressHoverTime.style.left = `${percent * 100}%`;
    this.progressHoverTime.classList.add('visible');
  }

  hideProgressHover() {
    if (this.progressHoverTime) {
      this.progressHoverTime.classList.remove('visible');
    }
  }

  toggleFullscreen() {
    const container = document.querySelector('.player-container');
    if (document.fullscreenElement) {
      document.exitFullscreen();
      this.fullscreenBtn.classList.remove('fullscreen');
    } else {
      container.requestFullscreen();
      this.fullscreenBtn.classList.add('fullscreen');
    }
  }

  // 播放列表
  togglePlaylist() {
    this.playlistPanel.classList.toggle('visible');
    this.playlistToggleBtn.classList.toggle('active');
  }

  addToPlaylist(item) {
    const existingIndex = this.playlist.findIndex(p => p.url === item.url);
    if (existingIndex === -1) {
      this.playlist.push(item);
    } else if (item.title && this.playlist[existingIndex].title !== item.title) {
      this.playlist[existingIndex] = {
        ...this.playlist[existingIndex],
        ...item
      };
    }
    this.renderPlaylist();
    this.savePlaylist();
  }

  async removeFromPlaylist(index) {
    if (index >= 0 && index < this.playlist.length) {
      const item = this.playlist[index];
      // 同步删除播放历史
      try {
        await tauriAPI.deletePlayHistory(item.url);
        delete this.playHistory[item.url];
      } catch (e) {
        console.error('Failed to delete play history:', e);
      }
      this.playlist.splice(index, 1);
      if (this.currentIndex >= index) {
        this.currentIndex--;
      }
      this.renderPlaylist();
      this.savePlaylist();
    }
  }

  playFromPlaylist(index) {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
      const item = this.playlist[index];
      this.urlInput.value = item.url;
      this.loadSource(item.url, { title: item.title });
      this.renderPlaylist();
    }
  }

  // 播放下一个
  playNext() {
    if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length - 1) {
      this.playFromPlaylist(this.currentIndex + 1);
    }
  }

  // 清空播放列表
  async clearPlaylist() {
    if (this.playlist.length === 0) return;

    try {
      const confirmed = await tauriAPI.showConfirmDialog(`确定要清空播放列表吗？\n共有 ${this.playlist.length} 个视频`);
      if (!confirmed) return;
    } catch (e) {
      console.error('Failed to show confirm dialog:', e);
      return;
    }

    // 如果正在播放，先停止
    if (this.isPlaying || !this.video.paused) {
      this.stop();
    }

    // 批量删除播放历史
    for (const item of this.playlist) {
      try {
        await tauriAPI.deletePlayHistory(item.url);
      } catch (e) {
        console.error('Failed to delete play history:', e);
      }
    }
    this.playHistory = {};

    // 清空数据
    this.playlist = [];
    this.currentIndex = -1;
    this.currentPlayingUrl = '';

    // 更新UI
    this.renderPlaylist();
    this.savePlaylist();
  }

  renderPlaylist() {
    this.playlistItems.replaceChildren();

    if (this.playlist.length === 0) {
      this.playlistItems.appendChild(this.createStatusElement('playlist-empty', '暂无播放列表'));
      return;
    }

    this.playlist.forEach((item, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'playlist-item';
      if (index === this.currentIndex) {
        wrapper.classList.add('active');
      }

      const info = document.createElement('div');
      info.className = 'playlist-item-info';

      const title = document.createElement('div');
      title.className = 'playlist-item-title';
      title.textContent = item.title || '未命名';

      const url = document.createElement('div');
      url.className = 'playlist-item-url';
      url.textContent = item.url || '';

      info.append(title, url);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'playlist-item-delete';
      deleteBtn.setAttribute('aria-label', '删除播放项');
      deleteBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      `;

      wrapper.addEventListener('click', (e) => {
        if (!e.target.closest('.playlist-item-delete')) {
          this.playFromPlaylist(index);
        }
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFromPlaylist(index);
      });

      wrapper.append(info, deleteBtn);
      this.playlistItems.appendChild(wrapper);
    });
  }

  showAddUrlModal() {
    const modal = document.createElement('div');
    modal.className = 'url-input-modal visible';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-title">添加 M3U8 URL</div>
        <input type="text" class="modal-input" id="newUrlInput" placeholder="输入 M3U8 地址...">
        <div class="modal-buttons">
          <button class="btn" id="cancelAddUrl">取消</button>
          <button class="btn btn-primary" id="confirmAddUrl">添加</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const newUrlInput = modal.querySelector('#newUrlInput');
    newUrlInput.focus();

    modal.querySelector('#cancelAddUrl').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('#confirmAddUrl').addEventListener('click', () => {
      const url = newUrlInput.value.trim();
      if (url) {
        const title = this.extractTitle(url);
        this.addToPlaylist({ url, title });
        document.body.removeChild(modal);
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });

    newUrlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        modal.querySelector('#confirmAddUrl').click();
      }
    });
  }

  createStatusElement(className, text) {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = text;
    return element;
  }

  createBackButton(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-small';
    btn.textContent = label;
    btn.style.marginBottom = '8px';
    btn.addEventListener('click', onClick);
    return btn;
  }

  showSearchStatus(className, text) {
    this.searchResults.replaceChildren(this.createStatusElement(className, text));
  }

  appendCacheBadge(target) {
    const badge = document.createElement('span');
    badge.className = 'cache-badge';
    badge.textContent = '缓存';
    target.appendChild(badge);
  }

  // 事件处理
  onPlay() {
    this.isPlaying = true;
    this.playPauseBtn.classList.add('playing');
  }

  onPause() {
    this.isPlaying = false;
    this.playPauseBtn.classList.remove('playing');
  }

  onTimeUpdate() {
    const current = this.video.currentTime;
    const duration = this.video.duration || 0;

    this.currentTimeEl.textContent = this.formatTime(current);
    this.durationEl.textContent = this.formatTime(duration);

    if (duration > 0) {
      const percent = (current / duration) * 100;
      this.progressPlayed.style.width = `${percent}%`;
    }

    // 跳过片头（开始后5秒内）
    if (this.currentSkipIntro > 0 && !this.hasSkippedIntro) {
      if (current < this.currentSkipIntro && current < 5) {
        this.video.currentTime = this.currentSkipIntro;
        this.hasSkippedIntro = true;
        return;
      }
    }

    // 跳过片尾（自动播放下一集）
    if (this.currentSkipOutro > 0 && duration > 0) {
      const outroStart = duration - this.currentSkipOutro;
      if (current > outroStart && current < duration - 1) {
        this.playNext();
      }
    }
  }

  onLoadedMetadata() {
    this.durationEl.textContent = this.formatTime(this.video.duration);
  }

  onProgress() {
    if (this.video.buffered.length > 0) {
      const buffered = this.video.buffered.end(this.video.buffered.length - 1);
      const duration = this.video.duration || 0;
      if (duration > 0) {
        const percent = (buffered / duration) * 100;
        this.progressBuffered.style.width = `${percent}%`;
      }
    }
  }

  onError() {
    const error = this.video.error;
    let message = '播放错误';
    if (error) {
      switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          message = '播放被中断';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          message = '网络错误';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          message = '解码错误';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          message = '不支持的格式';
          break;
      }
    }
    this.showError(message);
  }

  showLoading() {
    this.videoOverlay.classList.add('active');
    this.loadingSpinner.style.display = 'block';
    this.errorMessage.style.display = 'none';
  }

  hideLoading() {
    this.videoOverlay.classList.remove('active');
    this.loadingSpinner.style.display = 'none';
  }

  showError(message) {
    this.videoOverlay.classList.add('active');
    this.loadingSpinner.style.display = 'none';
    this.errorMessage.textContent = message;
    this.errorMessage.style.display = 'block';
  }

  hideError() {
    this.videoOverlay.classList.remove('active');
    this.errorMessage.style.display = 'none';
  }

  // 工具方法
  formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  extractTitle(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop();
      if (filename && filename !== '') {
        return filename.replace(/\.(m3u8|m3u)$/i, '');
      }
    } catch (e) {}
    return '未命名';
  }

  handleKeyboard(e) {
    // 忽略输入框中的快捷键
    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.video.currentTime = Math.max(0, this.video.currentTime - 10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.setVolume(Math.min(1, this.volume + 0.1));
        this.volumeSlider.value = this.volume;
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.setVolume(Math.max(0, this.volume - 0.1));
        this.volumeSlider.value = this.volume;
        break;
      case 'm':
        this.toggleMute();
        break;
      case 'f':
        this.toggleFullscreen();
        break;
      case '[':
        this.adjustSpeed(-0.25);
        break;
      case ']':
        this.adjustSpeed(0.25);
        break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        e.preventDefault();
        const percent = parseInt(e.key) * 10;
        if (this.video.duration) {
          this.video.currentTime = (percent / 100) * this.video.duration;
        }
        break;
    }
  }

  // 搜索功能
  showSearchPanel() {
    this.searchPanel.classList.add('visible');
    this.searchInput.focus();
  }

  hideSearchPanel() {
    this.searchPanel.classList.remove('visible');
  }

  // 搜索缓存相关方法
  getCache(keyword, source = 'hongniu') {
    try {
      const cacheKey = this.searchCache.prefix + source + '_' + keyword;
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      const now = Date.now();

      if (now - timestamp > this.searchCache.expire) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return data;
    } catch (e) {
      return null;
    }
  }

  setCache(keyword, data, source = 'hongniu') {
    try {
      const cacheKey = this.searchCache.prefix + source + '_' + keyword;
      const cacheData = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    } catch (e) {
      console.error('Failed to save cache:', e);
    }
  }

  async doSearch() {
    const keyword = this.searchInput.value.trim();
    if (!keyword) return;

    // 保存搜索历史
    await this.saveSearchHistory(keyword);

    // 获取选择的搜索源
    const source = this.searchSourceSelect.value;

    if (source === 'jav') {
      await this.doJavSearch(keyword);
    } else {
      await this.doMovieSearch(keyword);
    }
  }

  async doMovieSearch(keyword) {
    this.currentMovieKeyword = keyword;
    this.movieSourceResults = {};
    this.movieSourceCacheState = {};
    this.showSearchStatus('search-loading', '搜索中...');

    const responses = await Promise.all(this.movieSources.map(async (source) => {
      const sourceId = source.id;
      const cached = this.getCache(keyword, sourceId);
      if (Array.isArray(cached) && cached.length > 0) {
        return { source: sourceId, results: cached, fromCache: true, error: null };
      }

      try {
        const result = await tauriAPI.searchResource(keyword, sourceId);
        if (!result.success) {
          return { source: sourceId, results: [], fromCache: false, error: result.error };
        }
        const results = result.results || [];
        if (results.length > 0) {
          this.setCache(keyword, results, sourceId);
        }
        return { source: sourceId, results, fromCache: false, error: null };
      } catch (e) {
        return { source: sourceId, results: [], fromCache: false, error: e.message || String(e) };
      }
    }));

    responses.forEach((response) => {
      this.movieSourceResults[response.source] = response.results;
      this.movieSourceCacheState[response.source] = response.fromCache;
    });

    const availableSource = this.movieSources.find((source) =>
      (this.movieSourceResults[source.id] || []).length > 0
    );
    if (!availableSource) {
      const errors = responses.map((response) => response.error).filter(Boolean);
      this.showSearchStatus(
        errors.length > 0 ? 'search-error' : 'search-empty',
        errors.length > 0 ? `搜索失败: ${errors.join('；')}` : '未找到相关资源'
      );
      return;
    }

    this.currentMovieSource = availableSource.id;
    this.renderMovieSourceResults();
  }

  renderMovieSourceResults() {
    this.searchResults.replaceChildren();

    const tabs = document.createElement('div');
    tabs.className = 'movie-source-tabs';
    const select = document.createElement('select');
    select.id = 'movieSourceSelect';
    select.className = 'movie-source-select';
    select.setAttribute('aria-label', '搜索结果源');

    let firstAvailable = null;
    this.movieSources.forEach((source) => {
      const results = this.movieSourceResults[source.id] || [];
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = `${source.name}${results.length ? ` (${results.length})` : ''}`;
      option.disabled = results.length === 0;
      if (results.length > 0 && firstAvailable === null) {
        firstAvailable = source.id;
      }
      select.appendChild(option);
    });

    if ((this.movieSourceResults[this.currentMovieSource] || []).length === 0) {
      this.currentMovieSource = firstAvailable || this.movieSources[0].id;
    }
    select.value = this.currentMovieSource;

    select.addEventListener('change', () => {
      this.currentMovieSource = select.value;
      this.renderMovieSourceResults();
    });
    tabs.appendChild(select);
    this.searchResults.appendChild(tabs);

    const resultList = document.createElement('div');
    resultList.className = 'movie-source-results';
    this.searchResults.appendChild(resultList);
    this.renderSearchResults(
      this.movieSourceResults[this.currentMovieSource] || [],
      this.movieSourceCacheState[this.currentMovieSource] || false,
      resultList
    );
  }

  async doJavSearch(keyword, page = 1) {
    console.log('JAV Searching for:', keyword, 'page:', page);

    this.currentJavKeyword = keyword;
    this.currentJavPage = page;

    const cacheKey = `jav_${keyword}_${page}`;
    const cached = this.getCache(cacheKey);
    if (Array.isArray(cached) && cached.length > 0) {
      console.log('Using cached JAV result for:', keyword, 'page:', page);
      this.renderJavSearchResults(cached, page, true);
      return;
    }

    this.showSearchStatus('search-loading', '搜索中...');

    try {
      const result = await tauriAPI.searchJav(keyword, page);
      console.log('JAV Search result:', result);

      if (!result.success) {
        this.showSearchStatus('search-error', `搜索失败: ${result.error}`);
        return;
      }

      if (!result.results || result.results.length === 0) {
        this.showSearchStatus('search-empty', '未找到相关资源');
        return;
      }

      // 保存到缓存
      this.setCache(cacheKey, result.results);

      this.renderJavSearchResults(result.results, page);
    } catch (e) {
      console.error('JAV Search error:', e);
      this.showSearchStatus('search-error', `搜索失败: ${e.message || e}`);
    }
  }

  // 上一页
  async prevJavPage() {
    if (this.currentJavPage > 1) {
      await this.doJavSearch(this.currentJavKeyword, this.currentJavPage - 1);
    }
  }

  // 下一页
  async nextJavPage() {
    await this.doJavSearch(this.currentJavKeyword, this.currentJavPage + 1);
  }

  renderJavSearchResults(results, currentPage = 1, fromCache = false) {
    this.currentJavResults = results;
    this.searchResults.replaceChildren();

    results.forEach((item) => {
      const resultItem = document.createElement('div');
      resultItem.className = 'search-result-item with-cover';

      if (item.cover) {
        const cover = document.createElement('img');
        cover.className = 'search-result-cover';
        cover.alt = '封面';
        cover.src = item.cover;
        cover.addEventListener('error', () => {
          cover.remove();
        }, { once: true });
        resultItem.appendChild(cover);
      }

      const info = document.createElement('div');
      info.className = 'search-result-info';

      const title = document.createElement('div');
      title.className = 'search-result-title';
      title.textContent = item.title || '未命名';
      if (fromCache) {
        this.appendCacheBadge(title);
      }

      const meta = document.createElement('div');
      meta.className = 'search-result-meta';

      const type = document.createElement('span');
      type.className = 'search-result-type';
      type.textContent = '小电影';
      meta.appendChild(type);

      info.append(title, meta);
      resultItem.appendChild(info);

      resultItem.addEventListener('click', () => {
        this.showJavVideoDetail(item);
      });

      this.searchResults.appendChild(resultItem);
    });

    const paginationBar = document.createElement('div');
    paginationBar.className = 'pagination-bar';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-small';
    prevBtn.textContent = '上一页';
    prevBtn.disabled = currentPage <= 1;
    prevBtn.addEventListener('click', () => this.prevJavPage());

    const pageInfo = document.createElement('span');
    pageInfo.className = 'page-info';
    pageInfo.textContent = `第 ${currentPage} 页`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-small';
    nextBtn.textContent = '下一页';
    nextBtn.addEventListener('click', () => this.nextJavPage());

    paginationBar.append(prevBtn, pageInfo, nextBtn);
    this.searchResults.appendChild(paginationBar);
  }

  // 显示 JAV 视频详情（获取播放地址）
  async showJavVideoDetail(item) {
    this.searchResults.replaceChildren();
    this.searchResults.appendChild(this.createBackButton('返回搜索结果', () => this.backToJavResults()));
    this.searchResults.appendChild(this.createStatusElement('search-loading', '正在获取播放地址...'));

    try {
      const result = await tauriAPI.getJavVideoUrl(item.url, item.cover || '');

      if (!result.success || !result.stream) {
        this.searchResults.replaceChildren();
        this.searchResults.appendChild(this.createBackButton('返回搜索结果', () => this.backToJavResults()));
        this.searchResults.appendChild(this.createStatusElement('search-error', `获取播放地址失败: ${result.error}`));
        return;
      }

      this.currentResourceTitle = item.title || '未命名';
      const m3u8Url = result.stream;
      this.urlInput.value = m3u8Url;
      this.loadSource(m3u8Url);
      this.titleDisplay.textContent = this.currentResourceTitle;
      this.addToPlaylist({
        url: m3u8Url,
        title: this.currentResourceTitle
      });

      // 显示播放状态和返回按钮
      this.searchResults.replaceChildren();
      this.searchResults.appendChild(this.createBackButton('返回搜索结果', () => this.backToJavResults()));
      const playingDiv = document.createElement('div');
      playingDiv.className = 'search-result-item';
      playingDiv.textContent = `正在播放: ${this.currentResourceTitle}`;
      this.searchResults.appendChild(playingDiv);
    } catch (e) {
      this.searchResults.replaceChildren();
      this.searchResults.appendChild(this.createBackButton('返回搜索结果', () => this.backToJavResults()));
      this.searchResults.appendChild(this.createStatusElement('search-error', `播放失败: ${e.message || e}`));
    }
  }

  // 返回 JAV 搜索结果列表
  backToJavResults() {
    if (this.currentJavResults) {
      this.renderJavSearchResults(this.currentJavResults, this.currentJavPage, true);
    } else if (this.currentJavKeyword) {
      this.doJavSearch(this.currentJavKeyword, this.currentJavPage);
    } else {
      this.doSearch();
    }
  }

  // 解析 vod_play_url 格式
  parseVodPlayUrl(vodPlayUrl) {
    if (!vodPlayUrl) return [];
    const sources = vodPlayUrl.split('$$$');
    return sources.map((source, index) => {
      const episodes = source.split('#').filter(ep => ep.includes('$')).map(ep => {
        const dollarIndex = ep.indexOf('$');
        const name = ep.substring(0, dollarIndex);
        const url = ep.substring(dollarIndex + 1);
        return { name, url };
      });
      return {
        name: `线路 ${index + 1}`,
        episodes
      };
    }).filter(source => source.episodes.length > 0);
  }

  renderSearchResults(results, fromCache = false, container = this.searchResults) {
    container.replaceChildren();

    results.forEach((item) => {
      const resultItem = document.createElement('div');
      resultItem.className = 'search-result-item with-cover';

      // 封面图
      if (item.cover) {
        const cover = document.createElement('img');
        cover.className = 'search-result-cover';
        cover.alt = '封面';
        cover.src = item.cover;
        cover.addEventListener('error', () => {
          cover.remove();
        }, { once: true });
        resultItem.appendChild(cover);
      }

      const info = document.createElement('div');
      info.className = 'search-result-info';

      const title = document.createElement('div');
      title.className = 'search-result-title';
      title.textContent = item.title || '未命名';
      if (fromCache) {
        this.appendCacheBadge(title);
      }

      const meta = document.createElement('div');
      meta.className = 'search-result-meta';

      const sources = this.parseVodPlayUrl(item.vodPlayUrl);
      const totalEpisodes = sources.reduce((sum, s) => sum + s.episodes.length, 0);
      const type = document.createElement('span');
      type.className = 'search-result-type';
      type.textContent = totalEpisodes > 0 ? `${totalEpisodes}集` : '影视';
      meta.appendChild(type);

      info.append(title, meta);
      resultItem.appendChild(info);

      resultItem.addEventListener('click', () => {
        this.currentResourceTitle = item.title || '未命名';
        const parsedSources = this.parseVodPlayUrl(item.vodPlayUrl);
        if (parsedSources.length === 0) {
          this.showSearchStatus('search-empty', '该资源暂无播放地址');
          return;
        }
        this.currentParsedSources = parsedSources;
        this.renderEpisodesFromParsed(parsedSources);
      });

      container.appendChild(resultItem);
    });
  }

  // 渲染从 parseVodPlayUrl 解析出的剧集列表
  renderEpisodesFromParsed(sources) {
    this.searchResults.replaceChildren();

    // 返回按钮
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-small';
    backBtn.textContent = '返回搜索结果';
    backBtn.style.marginBottom = '8px';
    backBtn.addEventListener('click', () => this.renderMovieSourceResults());
    this.searchResults.appendChild(backBtn);

    // 资源标题
    const titleHeader = document.createElement('div');
    titleHeader.className = 'search-result-item';
    const titleText = document.createElement('div');
    titleText.className = 'search-result-title';
    titleText.textContent = this.currentResourceTitle;
    titleHeader.appendChild(titleText);
    this.searchResults.appendChild(titleHeader);

    sources.forEach((source) => {
      const lineHeader = document.createElement('div');
      lineHeader.className = 'search-result-item';
      const lineTitle = document.createElement('div');
      lineTitle.className = 'search-result-title';
      lineTitle.textContent = source.name;
      lineHeader.appendChild(lineTitle);

      const episodesContainer = document.createElement('div');
      episodesContainer.className = 'line-episodes';

      source.episodes.forEach((episode) => {
        const button = document.createElement('button');
        button.className = 'line-episode-btn';
        button.dataset.url = episode.url;
        button.textContent = episode.name;
        button.addEventListener('click', async (e) => {
          e.stopPropagation();
          this.searchResults.querySelectorAll('.line-episode-btn').forEach((b) => b.classList.remove('playing'));
          button.classList.add('playing');
          this.playEpisodeDirect(episode.url, episode.name);
        });
        episodesContainer.appendChild(button);
      });
      this.searchResults.append(lineHeader, episodesContainer);
    });
  }

  // 直接使用URL播放剧集
  playEpisodeDirect(url, episodeName) {
    this.urlInput.value = url;
    this.loadSource(url);
    this.titleDisplay.textContent = `${this.currentResourceTitle} - ${episodeName}`;

    this.addToPlaylist({
      url: url,
      title: `${this.currentResourceTitle} - ${episodeName}`
    });
  }
}

// 初始化播放器
document.addEventListener('DOMContentLoaded', () => {
  window.player = new M3U8Player();
});
