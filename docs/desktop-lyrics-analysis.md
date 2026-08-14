# 桌面歌词（Desktop Lyrics）源码考察 —— 已核实事实库

> 本文档是**只读源码考察**的产物，目标是建立"经过源码验证的事实"，而非实现方案。
> 每个关键结论都附 `文件:行号` 依据。无法从源码确认的结论统一标记为 **【待确认】**，不猜测。
> 考察日期：2026-08-14。考察对象：`development` 分支。

---

## 1. 已确认事实

### A. Electron 多窗口

- **主进程入口**：`src/main/index.ts`。应用启动 `app.whenReady().then(...)` —— `src/main/index.ts:1126-1206`；单实例锁 `app.requestSingleInstanceLock()` —— `src/main/index.ts:1109`。
- **全局唯一的窗口引用**：`let mainWindow: BrowserWindow | null = null` —— `src/main/index.ts:357`。
- **唯一的窗口创建函数**：`async function createWindow(first = true)` —— `src/main/index.ts:592`，内部 `mainWindow = new BrowserWindow({...})` —— `src/main/index.ts:618`。
- **`getMainWindow()`**：导出并返回 `mainWindow` —— `src/main/index.ts:435-437`。全仓库无第二个 `new BrowserWindow(...)`（托盘 `createTray` 创建的是 `Tray`，非窗口）。
- **主窗口 `webPreferences`**：`contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`、`preload: join(__dirname,'../preload/index.js')`、`backgroundThrottling:false` —— `src/main/index.ts:626-635`；窗口外观 `frame:false`、`width:1440`、`height:900`、`show:false` —— `src/main/index.ts:618-624`。
- **窗口类 IPC 全部硬编码 `mainWindow`**（注册在 `createWindow` 内部）：`window-dev-tools`/`window-maximize`/`window-unmaximize`/`window-minimize`/`window-close`/`window-quit`/`window-clear-cache` —— `src/main/index.ts:666-695`。
- **窗口关闭生命周期**：
  - `mainWindow.on('closed', ...)` 里 `mainWindow = null` 并移除 handler —— `src/main/index.ts:791-796`。
  - `mainWindow.on('close', ...)` 里若启用 `window_exit_to_tray` 则 `event.preventDefault()` + `hide()` —— `src/main/index.ts:808-817`。
  - `app.on('window-all-closed', ...)`：非 macOS 直接 `app.quit()`；macOS 置 `mainWindow = null` —— `src/main/index.ts:1070-1079`。
- **主进程 → 渲染进程的消息**：均为 `getMainWindow()?.webContents.send(...)`。示例：`sendToastToRenderer` 发 `toast-from-main` —— `src/main/index.ts:465-476`；Windows 缩略图按钮发 `renderer-player-previous/play-pause/next` —— `src/main/index.ts:478-498`。
- **结论**：当前代码库**不存在**多窗口/子窗口抽象；所有窗口 IPC 与主进程推送都硬编码到 `mainWindow`。

### B. preload / IPC

- **API 暴露**：`contextBridge.exposeInMainWorld('api', api)` —— `src/preload/index.ts:41`；`api` 对象含 `autodiscover, browser, customThemes, discordRpc, getPathForFile, ipc, localSettings, lyrics, mpris, mpvPlayer, mpvPlayerListener, remote, utils, visualizer` —— `src/preload/index.ts:17-32`；类型 `export type PreloadApi = typeof api` —— `src/preload/index.ts:34`。
- **播放控制命令对象** `mpvPlayer`：`play/pause/next/previous/seek/seekTo/stop/volume/...`，均 `ipcRenderer.send('player-*')` 或 `invoke` —— `src/preload/mpv-player.ts:193-218`（如 `seekTo` → `player-seek-to` —— `:61-63`；`getCurrentTime` → `player-get-time` —— `:85-87`）。
- **播放监听对象** `mpvPlayerListener`：把主进程推送的 `renderer-player-*` 通道映射为回调注册函数 —— `src/preload/mpv-player.ts:220-243`。关键项：
  - `rendererPlayPause` = `ipcRenderer.on('renderer-player-play-pause', ...)` —— `:133-135`
  - `rendererNext` = `'renderer-player-next'` —— `:117-119`
  - `rendererPrevious` = `'renderer-player-previous'` —— `:137-139`
- **歌词 preload**：`getRemoteLyricsBySong(song)` = `ipcRenderer.invoke('lyric-by-song', song)` —— `src/preload/lyrics.ts:12-15`；`searchRemoteLyrics` → `lyric-search`、`getRemoteLyricsByRemoteId` → `lyric-by-remote-id` —— `src/preload/lyrics.ts:17-27`。
- **功能类 IPC 注册方式**：通过模块导入副作用注册（`ipcMain.handle`/`ipcMain.on`），集中在 `src/main/features/core/*/index.ts`。

### C. 外部控制 → 主窗口播放动作 的完整中继链（已逐行确认）

```
托盘/缩略图按钮/全局快捷键
  → getMainWindow()?.webContents.send('renderer-player-play-pause')     main/index.ts:487（示例）
  → mpvPlayerListener.rendererPlayPause = ipcRenderer.on('renderer-player-play-pause')   preload/mpv-player.ts:133-135
  → useMainPlayerListener 内 rendererPlayPause(() => mediaTogglePlayPause())             use-main-player-listener.tsx:51-55
  → mediaTogglePlayPause()（来自 usePlayerActions()）                                    player.store.ts:1339（store action）
```
- 同类映射：`rendererNext` → `mediaNext(false)`（`use-main-player-listener.tsx:57-61`）；`rendererPrevious` → `mediaPrevious(false)`（`:69-73`）。
- 该 hook 卸载时 `ipc?.removeAllListeners('renderer-player-*')` —— `use-main-player-listener.tsx:131-146`。

### D. 播放状态（player store + timestamp store）

- **store 创建方式**：`usePlayerStoreBase = createWithEqualityFn<PlayerState>()(persist(subscribeWithSelector(immer(...))))` —— `src/renderer/store/player.store.ts:354-357`。这是**渲染进程内的模块级单例**。
- **初始状态**：`initialState.player = { index, status: PlayerStatus.PAUSED, volume:30, repeat, shuffle, playerNum, seekToTimestamp, ... }`；`initialState.queue = { default:[], shuffled:[], songs:{} }` —— `player.store.ts:330-352`。
- **当前歌曲**：`getCurrentSong()` 由 `state.getQueue()` + `state.player.index`（shuffle 映射）派生 —— `player.store.ts:771-782`。
- **播放数据**：`getPlayerData()` 返回 `{ currentSong, nextSong, previousSong, player1, player2, status, ... }` —— `player.store.ts:783-850`。
- **状态读取 hook**：`usePlayerStatus()` → `state.player.status` —— `player.store.ts:2202-2204`；`usePlayerSong()` → `state.getCurrentSong()` —— `player.store.ts:2218-2231`。
- **订阅函数**（`subscribeWithSelector` 提供）：
  - `subscribeCurrentTrack` —— `player.store.ts:1853-1879`（按 `_uniqueId` 判等，`equalityFn` —— `:1874-1876`）
  - `subscribePlayerStatus` —— `player.store.ts:1951-1960`
  - `subscribePlayerSeekToTimestamp` —— `player.store.ts:1962-1974`
- **seek 动作**：`mediaSeekToTimestamp(timestamp)` = `setTimestampStore(timestamp)` + `state.player.seekToTimestamp = uniqueSeekToTimestamp(timestamp)` —— `player.store.ts:1274-1281`。
- **action 聚合**：`usePlayerActions()` 返回 memoized 动作 + `setTimestamp: setTimestampStore` —— `player.store.ts:1768-1820`（`:1816`）。
- **持久化**：`name:'player-store'`、`storage: playerStoreStorage`（IndexedDB，见下）、`version:4` —— `player.store.ts:1728,1760-1761`。`partialize` 排除 `playerNum/seekToTimestamp/status`（`index` 视 `resume` 决定）—— `player.store.ts:1732-1758`。
- **进度位置在独立 store**：`useTimestampStoreBase`，字段 `timestamp`（**单位：秒**），默认 `0` —— `src/renderer/store/timestamp.store.ts:29-43`。轮询间隔常量 `PLAYER_TIMESTAMP_POLL_INTERVAL_MS = 500` —— `:6`。
- **进度订阅/写入**：`subscribePlayerProgress` —— `timestamp.store.ts:45-59`；`setTimestamp(timestamp)` → `useTimestampStoreBase.getState().setTimestamp(timestamp)` —— `:87-89`。
- **各引擎把进度写入 timestamp store**（`setTimestamp` 均为 `usePlayerActions().setTimestamp` 即 `setTimestampStore`）：
  - web：`web-player.tsx:131` 与 `:194` → `setTimestamp(e.playedSeconds)`
  - mpv：`mpv-player.tsx:165` → `setTimestamp(time)`（时间来自引擎 `onProgress`）
  - wavesurfer：`wavesurfer-player.tsx:82`、`:123` → `setTimestamp(e.playedSeconds)`
  - jukebox：`jukebox-player.tsx:53`、`:102` → `setTimestamp(Math.floor(position))`
- **seek 落地的最后一行（已确认）**：`subscribePlayerSeekToTimestamp`（`player.store.ts:1962`）在 `use-player-events.ts:114` 被订阅到 `callbacks.onPlayerSeekToTimestamp`；各播放包装组件提供该回调并调用引擎 seek：`web-player.tsx:302`、`mpv-player.tsx:106`、`jukebox-player.tsx:80`、`wavesurfer-player.tsx:197`。
- **关键结论：桌面歌词窗口不能直接调用现有 player/timestamp store。**
  依据：`usePlayerStoreBase`（`player.store.ts:354`）、`useTimestampStoreBase`（`timestamp.store.ts:29`）、`useSettingsStore`（`settings.store.ts:2228`）都是**渲染进程内的模块级单例**。Electron 每个 `BrowserWindow` = 独立渲染进程 = 独立 JS 运行时与模块图，第二个窗口 `import` 这些 store 会得到**全新的实例**，从 `initialState` 开始，与主窗口实例**无共享内存**。代码中不存在把 zustand 状态同步到第二窗口的 IPC。

### E. 歌词

- **歌词获取入口（渲染层）**：`lyricsQueries.songLyrics`（React Query）—— `src/renderer/features/lyrics/api/lyrics-api.ts:271-378`（本文件仅核对到 `lyricsQueries.search` `:256-269`，`songLyrics` 定义在同文件 `lyricsQueries` 对象内）。内部走 `fetchLocalLyrics`（`:147-191`）+ `fetchRemoteLyricsAuto`（`:193-207`）。
- **远程歌词完整 IPC 链**：
  - `fetchRemoteLyricsAuto` 先读 `useSettingsStore.getState().lyrics.fetch`，再 `lyricsIpc?.getRemoteLyricsBySong(song)` —— `lyrics-api.ts:193-207`
  - `getRemoteLyricsBySong` = `ipcRenderer.invoke('lyric-by-song', song)` —— `preload/lyrics.ts:12-15`
  - `ipcMain.handle('lyric-by-song')` → `getRemoteLyrics(song)` —— `src/main/features/core/lyrics/index.ts:228-231`、`:120`
- **歌词解析（渲染层）**：`formatLyrics(lyrics)` 用 LRC 正则 `timeExp`（`:43`）与网易卡拉OK正则 `alternateTimeExp`（`:47`），输出 `SynchronizedLyrics`（`{startMs,text}[]`）—— `lyrics-api.ts:49-80`。导出别名 `formatLyricsForDisplay` —— `:82`。
- **歌词类型（渲染层，`src/shared/types/domain-types.ts`）**：`SynchronizedLyrics = SynchronizedLyricLine[]`；`SynchronizedLyricLine = { cueLines?, startMs, text }`（见 `lyrics-utils.ts` 的 import 与使用，`domain-types.ts` 具体行号见上次读取）。
- **主进程歌词类型**：`LyricSource = { GENIUS, LRCLIB, NETEASE, SIMPMUSIC }` —— `main/features/core/lyrics/index.ts:23-28`；`SynchronizedLyricsArray = Array<[number, string]>`（元组形式，供远程 provider）—— `:70`；`LyricsResponse = string | SynchronizedLyricsArray` —— `:68`。
- **两层结构归一化**：渲染层 `normalizeLyricsLine` 兼容"元组"与"对象"两种歌词行 —— `src/renderer/features/lyrics/api/lyrics-utils.ts:15-26`；`normalizeLyrics` —— `:28-30`。
- **歌词分层（结构化多轨）**：`getLyricsLayers(local: StructuredLyric[])` 拆出 `{ main, others, overlayLayers, pronunciation, translation }`，按 `kind`（`translation`/`pronunciation`/`main`）识别 —— `lyrics-utils.ts:173-203`。
- **行级翻译对照**：`findOverlayLineByTime(overlayLyrics, startMs, lineIndex)` 按时间匹配翻译/发音行 —— `lyrics-utils.ts:134-138`。
- **高亮依据的时间**：`SynchronizedLyrics` 组件读 `useTimestampStoreBase.getState().timestamp`（秒）→ `timeInMs = timestamp * 1000 + delayMsRef.current` —— `src/renderer/features/lyrics/synchronized-lyrics.tsx:134-135`、`:152-154`。由 `requestAnimationFrame` 循环（`startRaf`，`:125-149`）+ `subscribePlayerStatus`（`:190-206`）+ `subscribePlayerProgress`（`:208-226`）驱动。
- **点击歌词 seek**：`handleSeek(time)` 分支——LOCAL(mpv) 直接 `mpvPlayer.seekTo(time)`；否则 `mpris?.updateSeek(time)` + `mediaSeekToTimestamp(time)` —— `src/renderer/features/lyrics/hooks/use-synchronized-lyrics-base.ts:66-76`。点击由 `handleLineClick` 读 `data-lyric-time` 触发 —— `:78-91`。
- **歌词 hook 依赖的 store**：`useSynchronizedLyricsBase` 用 `usePlaybackType`/`useLyricsSettings`/`useLyricsDisplaySettings`/`usePlayerActions` —— `use-synchronized-lyrics-base.ts:28-32`。

### F. Store / State / 持久化

- **三个 zustand store 均在渲染进程**（模块级单例）：`usePlayerStoreBase`（`player.store.ts:354`）、`useTimestampStoreBase`（`timestamp.store.ts:29`）、`useSettingsStore`（`settings.store.ts:2228`）。
- **渲染层设置持久化**：`useSettingsStore` 的 persist 配置 `name:'store_settings'`、`version:33` —— `settings.store.ts:2875-2876`。**该 persist 配置没有 `storage:` 覆盖**（grep `storage:` 在该文件无命中），因此走 zustand 默认 `localStorage`，单键 `store_settings`。
- **player 持久化**：`storage: playerStoreStorage` —— `player.store.ts:1760`；`playerStoreStorage` 用 `idb-keyval`（IndexedDB）读写 `player-store` 与 `player-store-queue` 两个键 —— `src/renderer/store/utils.ts:73-146`。
- **timestamp 持久化**：`storage: timestampStorage`（IndexedDB，键 `player-timestamp`）—— `timestamp.store.ts:13-27`、`:38-39`。
- **主进程持久化**：electron-store `export const store = new Store<any>({...})` —— `src/main/features/core/settings/index.ts:103`；默认值含 `lyrics:['NetEase','lrclib.net']`、`playbackType:'web'` —— `:108-123`。
- **主进程 settings IPC**：`settings-get`（`handle`）—— `settings/index.ts:134-136`；`settings-set`（`on`）—— `:138-144`；`settings-set-sync`（`handle`）—— `:146-152`。
- **跨窗口广播先例（唯一）**：`notifyCustomCssUpdate` 用 `BrowserWindow.getAllWindows().forEach(w => w.webContents.send('custom-css-updated', ...))` —— `settings/index.ts:62-71`。它只推送一条 IPC 消息，**不**同步 zustand 状态。
- **重要更正**：`splitSettingsStorage`（`src/renderer/store/utils.ts:194-327`）定义了"把 `store_settings` 拆成多个 localStorage 键"的逻辑，但**全仓库无引用**（grep `splitSettingsStorage` 仅命中其定义处 `utils.ts:194`）。当前设置实际持久化为**单键 `store_settings`**（见上）。这纠正了此前"设置拆分为多个 localStorage 键"的错误结论。为何该文件保留但未使用 —— **【待确认】**。
- **设置 schema（渲染层）**：
  - `LyricsDisplaySettingsSchema`：`fontSize/gap/opacityNonActive/paddingLeft/paddingRight/scaleNonActive/...` —— `settings.store.ts:611-620`。
  - `LyricsSettingsSchema`：`alignment/delayMs/enableAutoTranslation/enableNeteaseTranslation/fetch/follow/lineLeadTimeMs/preferLocalLyrics/showMatch/showProvider/sources/translationApiProvider/...` —— `settings.store.ts:622-640`。
  - 顶层组合：`lyrics: LyricsSettingsSchema`、`lyricsDisplay: z.record(z.string(), LyricsDisplaySettingsSchema)` —— `settings.store.ts:820-821`。

### G. 构建系统（electron-vite）

- 配置 `electron.vite.config.ts`，三段 target：`main`（`:14-40`）、`preload`（`:41-52`）、`renderer`（`:53-88`）。
- **renderer 无显式 `build.rollupOptions.input`** —— `electron.vite.config.ts:53-88`（只有 `build.cssMinify/minify/modulePreload/sourcemap/target` + `css.modules` + `plugins` + `resolve.alias`）。因此 renderer 是单入口 `src/renderer/index.html`。
- 别名：`/@/main`、`/@/preload`、`/@/renderer`、`/@/shared`、`/@/i18n`、`/@/remote`、`/@/lyrics-conversion-api` —— `electron.vite.config.ts:34-39,46-51,74-87`。
- 主窗口加载：开发 `mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])`，生产 `mainWindow.loadFile(join(__dirname,'../renderer/index.html'))` —— `main/index.ts:892-895`。
- **为什么不能复用主窗口 HTML + query 参数**：`AppShell` 无条件渲染 `<PlayerProvider><AudioPlayers/><AppRouter/></PlayerProvider>` —— `src/renderer/app.tsx:100-103`。歌词窗口若加载同一入口，会在第二个窗口再挂一套播放引擎（mpv/web），造成双引擎。因此独立轻量渲染入口是必要前提，而非可选优化。

### H. 设置与 i18n

- 歌词设置组件：`LyricSettings` —— `src/renderer/features/settings/components/general/lyric-settings.tsx`（开关/下拉用 `Switch`/`Select`/`MultiSelect`，写入走 `setSettings({ lyrics:{...} })`，需镜像到主进程的项额外 `localSettings?.set(...)`）。
- 渲染层 → 主进程设置镜像：`useSyncSettingsToMain`（`src/renderer/hooks/use-sync-settings-to-main.ts`），由 `app.tsx` 的 `SyncSettingsEffect` 挂载 —— `app.tsx:127-131`、`:113-125`。
- i18n 语言文件：`src/i18n/locales/*.json`；初始化 `src/i18n/i18n.ts`。
- 新设置（"桌面歌词开关"）最贴合现有模式的位置是 `lyrics` 切片（`LyricsSettingsSchema` 增加字段）+ `LyricSettings` 增加一个 `Switch`，与既有 `fetch`/`follow` 开关一致。

---

## 2. 仍未确认的问题（【待确认】，不猜测）

1. **跨窗口 localStorage / IndexedDB 的 origin 语义**：打包后两个窗口都用 `loadFile('.../renderer/index.html')`（`file://` 协议）。Chromium 对 `file://` 是否让不同窗口共享同一个 localStorage/IndexedDB origin，**属运行时行为，源码中无法确认**。因此设计**不得**依赖"歌词窗口直接读主窗口 localStorage/IndexedDB"来同步设置或状态。
2. **`splitSettingsStorage` 为何保留但未被引用**：grep 已确认其在当前源码中零引用（死代码），但它是历史遗留、还是被构建/别名层间接使用，源码层面未确认。已确认的是当前 `useSettingsStore` 未使用它。
3. **新增第二 renderer entry 时 electron-vite 的确切产物行为**：当前 `electron.vite.config.ts` 无 `rollupOptions.input`，加第二入口需要改该文件；但 electron-vite 对多 renderer 入口的 HTML 输出命名/加载路径（`../renderer/<name>.html`）的具体行为未在源码中验证 —— 【待确认】。（实现时需按 electron-vite 文档/实际构建产物验证。）
4. **`idbStateStorage`（`store/utils.ts:166-176`）的使用方**：未追踪；与本功能无关，列为未追踪项。
5. **`usePlayerData()` / `useLyricsSettings` / `useLyricsDisplaySettings` 的具体实现行号**：本次已确认它们存在并被 `use-synchronized-lyrics-base.ts:28-32` 使用，但其在 `settings.store.ts` 中的精确定义行号未在本轮逐行核对（`usePlaybackType` 已核对为 `settings.store.ts:2890`）。

---

## 3. 桌面歌词真正需要解决的技术问题

基于以上已核实事实，按必要性排序：

1. **跨进程状态桥（核心，无现成方案）**
   主窗口渲染进程的 `player`（当前曲目/状态）、`timestamp`（进度秒）、`lyrics`/`lyricsDisplay`（设置）对歌词窗口**不可见**（见 D 结论）。
   现有可复用订阅：`subscribeCurrentTrack`（`player.store.ts:1853`）、`subscribePlayerStatus`（`player.store.ts:1951`）、`subscribePlayerProgress`（`timestamp.store.ts:45`）。需要新建一条"主窗口渲染进程订阅 → `ipc.send` → 主进程 → `getMainWindow()` 风格转发 → 歌词窗口"的快照通道。
   歌词窗口侧需要把接收到的快照**播种到本地 store 的最小切片**（`setTimestamp` / `usePlayerStoreBase.setState({player:{status}})` / `useSettingsStore.setState({lyrics,lyricsDisplay})`），否则无法复用 `SynchronizedLyrics`（它直接读这些 store，见 `synchronized-lyrics.tsx:134,190-226` 与 `use-synchronized-lyrics-base.ts:28-32`）。

2. **控制回流（部分可复用）**
   - 播放/暂停/上下曲：**可完全复用** `renderer-player-*` 通道 + `use-main-player-listener.tsx` 已建立的映射（C 节），歌词窗口只需 `ipcRenderer.send` 对应通道（经主进程转发到主窗口，或直接 `webContents.send` 到主窗口）。
   - **seek 无现成通道**，且 seek 是后端相关的：`use-synchronized-lyrics-base.ts:66-76` 按 `playbackType` 分 mpv/web。歌词窗口不能直接 `mpvPlayer.seekTo`（web 后端会失效），需把 seek 转发回主窗口复用 `handleSeek` 的分支逻辑。

3. **独立轻量渲染入口（必须）**
   否则会挂载第二套 `AudioPlayers`/`PlayerProvider`（`app.tsx:100-103` 无条件挂载），造成双引擎。需在 `electron.vite.config.ts` 增加 renderer 第二入口，并新建独立 HTML/入口组件。

4. **歌词 UI 复用 vs 最小耦合（实现层权衡，非现在拍板）**
   `SynchronizedLyrics` 直接依赖 `useTimestampStoreBase`/`usePlayerStoreBase`/`useLyricsSettings`/`useLyricsDisplaySettings`。要复用它，必须先把状态喂进这些 store（见问题 1）；否则需写一个不依赖这些 store 的轻量渲染器。

5. **窗口本身**（透明/置顶/鼠标穿透/锁定/清理）是纯 Electron 主进程能力，无既有代码可复，但可对齐 `mainWindow` 的 `webPreferences`（`main/index.ts:626-635`）、`getMainWindow()`/`webContents.send` 惯例、以及 `closed` 清理写法（`main/index.ts:791-796`）。

---

## 4. 当前不应该过早决定的设计问题

（这些进入实现前需拍板，但不阻塞"事实确认"阶段）

1. **歌词窗口如何复用歌词渲染**：播种现有 zustand store（最大化复用 `SynchronizedLyrics`）vs 写轻量适配器（最小耦合）。需先厘清 `SynchronizedLyrics` 对 store 的完整依赖面后再权衡。
2. **设置字段的归属与形态**：放 `lyrics` 切片内（如 `lyrics.desktopLyrics`）还是新建顶层切片；首版只做最小开关，还是含字号/颜色/置顶等子项——属产品/UI 决定。
3. **是否开机自动打开桌面歌词窗口**：若需要，主进程启动时就得知道该开关，牵涉"渲染层设置 → 主进程"镜像时机（现有镜像只在 `useSyncSettingsToMain` 启动时跑一次）。
4. **歌词窗口是否共用同一 preload / 是否限制其 `window.api` 暴露面**：`contextBridge` 目前对所有窗口统一暴露全量 API（`preload/index.ts:17-32`）；是否给歌词窗口做白名单是安全/简洁性取舍。
5. **多 renderer 入口的构建产物路径与加载方式**（对应第 2 节第 3 条待确认项）：需在实现前用实际构建验证，不宜现在凭经验假设。

---

> 本次考察未修改任何业务代码、未创建任何实现文件。事实依据均来自对上述文件的逐行读取与 grep。

---

# Implementation Design（第二阶段：最小架构方案）

> 状态：**设计稿，非实现**。本阶段不修改业务代码、不创建实现文件。
> 基线：本文件第 1–4 节的已核实事实。
> 范围：只设计窗口、独立 renderer entry、状态同步、控制请求、生命周期。**不含 UI、不含歌词控制栏、不含歌词渲染细节。**

## 0. 设计约束（复用第一阶段事实，不重新假设）

- player / timestamp / settings 三个 store 均为**渲染进程内单例**，第二窗口无法共享（§1.D）。
- 主窗口 `AppShell` 无条件挂载 `PlayerProvider → AudioPlayers`（`app.tsx:100-103`），桌面歌词**必须**用独立 renderer entry。
- 现有"外部命令 → 主窗口播放"中继 = `renderer-player-*` 通道 + `use-main-player-listener.tsx`（§1.C）。
- 现有 `renderer-player-*` **没有 seek 通道**；渲染层 seek 唯一正确入口是 `mediaSeekToTimestamp`（`player.store.ts:1274-1281`），经 `subscribePlayerSeekToTimestamp`（`player.store.ts:1962`）驱动各引擎（web `web-player.tsx:302` / mpv `mpv-player.tsx:106` / jukebox `jukebox-player.tsx:80` / wavesurfer `wavesurfer-player.tsx:197`）。
- 主进程已有 `BrowserWindow.getAllWindows().forEach(...)` 广播先例（`settings/index.ts:62-71`）。
- **新发现**：通用 preload `ipc` 只暴露 `removeAllListeners / removeListener / send`（`src/preload/ipc.ts:15-19`），**没有 `on`**。因此桌面歌词 renderer 无法用 `window.api.ipc` 接收 main→renderer 的消息——需要按 `mpvPlayerListener`（`preload/mpv-player.ts:220-243`）的既有模式新增专用监听对象。

## 1. 方案比较

### 方案 A：主窗口 renderer → main → Desktop Lyrics renderer（经主进程中转）

数据流：主窗口渲染进程（authoritative）订阅自身 store → `ipcRenderer.send` → 主进程 `ipcMain.on` → `desktopLyricsWindow.webContents.send` → 桌面歌词渲染进程。控制反向走同一中转。

| 维度 | 结论 |
| --- | --- |
| 实现复杂度 | 低。完全复用现有 `ipcRenderer.send`/`ipcMain.on`/`webContents.send` 模式，无新原语。 |
| 对现有代码侵入 | 低。只在 preload 增加一个监听对象、在 `core/index.ts` 注册一个模块、在 `app.tsx` 挂一个桥、`electron.vite.config.ts` 加一个入口。 |
| 生命周期管理 | 清晰。主进程是唯一知道"桌面歌词窗口是否存活"的一方，可做门控与清理。 |
| Electron 架构符合度 | 高。Electron 官方推荐、且与本仓库现有 IPC 完全一致。 |
| 可维护性 | 高。所有桌面歌词通道集中在一个模块，边界清晰。 |
| PR 接受度 | 高。不引入新通信范式。 |
| 状态双向竞争 | 低。权威态唯一（主窗口 store），桌面歌词只读 + 只发"请求"。 |
| Win/macOS/Linux 风险 | 与通信无关；风险集中在窗口透明/穿透（见 §Risks），三平台一致。 |

### 方案 B：renderer ↔ renderer 直接通信

可选项只有 `BroadcastChannel` / `localStorage` 事件 / `MessagePort`。前两者依赖"两个 renderer 同源"——而 `file://` 下多窗口是否同源本身是**【待确认】**（§2.1）。`MessagePort` 仍必须先经主进程握手建立端口。

| 维度 | 结论 |
| --- | --- |
| 实现复杂度 | 中高。需要额外建立 MessageChannel 握手，或依赖未确认的 origin 共享。 |
| 对现有代码侵入 | 中。引入仓库从未用过的通信原语。 |
| 生命周期管理 | 差。两 renderer 直接耦合，主进程失去对窗口存活与消息路由的控制，清理困难。 |
| Electron 架构符合度 | 低。Electron 惯用路径是经主进程中转，renderer 间直连是反模式。 |
| 可维护性 | 低。隐式依赖浏览器 origin 语义，难以调试。 |
| PR 接受度 | 低。 |
| 状态双向竞争 | 高。直连更容易催生"第二状态源"。 |
| Win/macOS/Linux 风险 | 高。`BroadcastChannel`/`localStorage` 在 `file://` 多窗口的行为跨平台不一致。 |

### 方案 C：Electron `MessageChannelMain` 直连两 renderer

主进程在开窗时用 `MessageChannelMain` 建一对 `MessagePort`，分别 `postMessage` 给主窗口与桌面歌词窗口，形成逻辑上的直连。

| 维度 | 结论 |
| --- | --- |
| 实现复杂度 | 高。需要管理 port 的建立/转移/关闭，代码量与心智成本显著高于 A。 |
| 对现有代码侵入 | 中。不侵入现有 player，但引入新范式。 |
| 生命周期管理 | 中。port 关闭需与窗口销毁严格配对。 |
| Electron 架构符合度 | 高（官方支持 renderer 间 port 直连），但与本仓库现状不一致。 |
| 可维护性 | 中。port 生命周期是额外的心智负担。 |
| PR 接受度 | 中。技术上可行，但 maintainer 大概率质疑"为什么不用现有 IPC 中转"。 |
| 状态双向竞争 | 低（如果仍把权威态留在主窗口）。 |
| Win/macOS/Linux 风险 | 低。 |

### 选择：**方案 A**

理由：唯一与仓库现有 IPC 一致、侵入最小、生命周期可门控、且满足"权威态唯一"的方案。B 依赖未确认的 origin 语义、C 引入不必要的 port 管理复杂度，均无收益。

## 2. 推荐架构（数据流图）

```
                        ┌───────────────────────────┐
                        │  主进程 (main process)      │
                        │  desktop-lyrics 模块       │
                        │  - create/show/close window │
                        │  - ipcMain.on 各通道        │
                        └───────┬───────────┬────────┘
              desktop-lyrics-   │           │  renderer-player-*（转发 play/pause/next/prev）
              window-state      │           │  desktop-lyrics-seek（转发 seek）
              desktop-lyrics-   │           │  desktop-lyrics-state / -config（转发快照）
              seek / state      │           │
                     ┌──────────▼──┐   ┌────▼──────────────────┐   ┌─────────────────────┐
                     │ 主窗口 renderer│   │  Desktop Lyrics renderer│   │  mpv 后端（主进程） │
                     │ (authoritative)│   │  (read-only mirror)     │   └─────────────────────┘
                     │ player store  │   │  seed 本地 store         │
                     │ timestamp store│   │  复用 lyrics 渲染组件    │
                     │ settings store│   │  → desktop-lyrics-control │
                     └───────────────┘   └──────────────────────────┘

  状态方向（authoritative → mirror）：
    主窗口 renderer 订阅 subscribeCurrentTrack / subscribePlayerStatus / subscribePlayerProgress
      → ipcRenderer.send('desktop-lyrics-state' / 'desktop-lyrics-config')
      → main ipcMain.on → desktopLyricsWindow.webContents.send(...)
      → 桌面歌词 renderer seed 本地 timestamp/player/settings store

  控制方向（mirror → authoritative）：
    桌面歌词 renderer → ipcRenderer.send('desktop-lyrics-control', action)
      → main：play/pause/next/prev → getMainWindow().webContents.send('renderer-player-*')（复用现有 use-main-player-listener）
              seek → getMainWindow().webContents.send('desktop-lyrics-seek', {timestamp})
              close/lock/unlock → main 本地处理窗口
      → 主窗口 renderer seek 监听器 → mediaSeekToTimestamp(timestamp)
```

**Authoritative state 结论**：唯一权威态是**主窗口渲染进程的 player/timestamp/settings store**。Desktop Lyrics renderer 永远是 **read-only mirror + interaction request**，不持有播放队列、不驱动引擎、不成为第二状态源。

## 3. IPC Channel Design

| Channel | Direction | Payload | Purpose | Source | Destination |
| ------- | --------- | ------- | ------- | ------ | ----------- |
| `desktop-lyrics-state` | 主窗口 renderer → main → 桌面歌词 renderer | `DesktopLyricsState` | 高频播放快照（song/status/timestamp/playbackType） | 主窗口 renderer（订阅 store） | 桌面歌词 renderer |
| `desktop-lyrics-config` | 主窗口 renderer → main → 桌面歌词 renderer | `DesktopLyricsConfig` | 低频配置快照（lyrics/lyricsDisplay 子集），开窗 + 变更时 | 主窗口 renderer | 桌面歌词 renderer |
| `desktop-lyrics-window-state` | main → 主窗口 renderer | `{ open: boolean }` | 通知主窗口 renderer 开始/停止推送快照（门控） | main（desktop-lyrics 模块） | 主窗口 renderer |
| `desktop-lyrics-control` | 桌面歌词 renderer → main | `DesktopLyricsControlAction` | 播放/暂停/上下曲/seek/close/lock/unlock 请求 | 桌面歌词 renderer | main |
| `desktop-lyrics-seek` | main → 主窗口 renderer | `{ timestamp: number }`（秒） | seek 转发（唯一需要新增的主窗口监听） | main | 主窗口 renderer → `mediaSeekToTimestamp` |
| `desktop-lyrics-open` | 主窗口 renderer → main | 无（或 `{ prefs? }`） | 打开桌面歌词窗口 | 主窗口 renderer（settings） | main |
| `desktop-lyrics-close` | 主窗口 renderer → main | 无 | 关闭桌面歌词窗口 | 主窗口 renderer（settings） | main |
| `desktop-lyrics-toggle` | 主窗口 renderer → main | 无 | 切换 | 主窗口 renderer（settings） | main |

> `open/close/toggle` 用 `invoke`（`desktopLyrics.open()/close()/toggle()`），其余用 `send`/`on`。

### 控制方向重点

- **play / pause / play-pause / next / previous**：main 收到 `desktop-lyrics-control` 后，转发到主窗口**已有**通道 `renderer-player-play-pause` / `renderer-player-play` / `renderer-player-pause` / `renderer-player-next` / `renderer-player-previous`，由 `use-main-player-listener.tsx:51-91` 处理。**零新增主窗口监听。**
- **seek**：**不能让桌面歌词 renderer 直接调用现有 seek API**，原因（均基于已确认事实）：
  1. 现有 preload `mpvPlayer.seekTo`（`preload/mpv-player.ts:61-63` → `player-seek-to`）只驱动**主进程 mpv 后端**，对 WEB（react-player）/ JUKEBOX / WAVESURFER 后端无效——会破坏 web 播放。
  2. 权威进度在**主窗口渲染进程的 timestamp store**（秒）；直接 `mpvPlayer.seekTo` 会绕过它，造成主窗口歌词高亮/进度显示与桌面歌词脱同步。
  3. 桌面歌词是 mirror；直接 seek 等于引入第二状态源。
  - **最合理转发**：`desktop-lyrics-control {type:'seek', timestamp}` → main → `desktop-lyrics-seek` → 主窗口 renderer 新监听器 → `mediaSeekToTimestamp(timestamp)`（`player.store.ts:1274-1281`）。该入口对**所有后端**统一生效（经 `subscribePlayerSeekToTimestamp` 到各引擎的 `onPlayerSeekToTimestamp`），并同步 timestamp store。timestamp 单位为**秒**，与 timestamp store 一致。
- **close / lock / unlock**：纯窗口行为，**由 main 本地处理**（`close()` / `setIgnoreMouseEvents` / `setAlwaysOnTop`），不转发到主窗口 renderer。

## 4. Desktop Lyrics Snapshot（TypeScript 草案，只写类型）

```ts
// src/shared/types/desktop-lyrics.ts（草案）
import type { QueueSong } from '/@/shared/types/domain-types';
import type { PlayerStatus, PlayerType } from '/@/shared/types/types';

// 高频播放快照（~4Hz，仅含随播放变化的最小字段）
export interface DesktopLyricsState {
    song: QueueSong | undefined;
    status: PlayerStatus; // PAUSED | PLAYING | STOPPED（types.ts:149-153）
    timestamp: number;    // 秒，与 timestamp store 同单位（timestamp.store.ts:35 默认 0）
    playbackType: PlayerType; // WEB | LOCAL | JUKEBOX（types.ts:160-164）
}

// 低频配置快照（开窗 + 变更时推送）
export interface DesktopLyricsConfig {
    lyrics: {
        alignment: 'center' | 'left' | 'right';
        delayMs: number;
        follow: boolean;
        followScrollAlignment: number;
        lineLeadTimeMs: number;
        showMatch: boolean;
        showProvider: boolean;
        enableAutoTranslation: boolean;
        enableNeteaseTranslation: boolean;
        enableFurigana?: boolean;
        enableRomaji?: boolean;
    };
    lyricsDisplay: {
        fontSize: number;
        gap: number;
        opacityNonActive: number;
        paddingLeft: number;
        paddingRight: number;
        scaleNonActive: number;
    };
}

// 控制动作（桌面歌词 renderer → main）
export type DesktopLyricsControlAction =
    | { type: 'play-pause' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'next' }
    | { type: 'previous' }
    | { type: 'seek'; timestamp: number } // 秒
    | { type: 'close' }
    | { type: 'lock' }
    | { type: 'unlock' };
```

### 歌词设置是否随 snapshot 传递（单独分析）

**结论：不随高频 snapshot 传递，用独立的低频 config 通道。** 理由：

1. **频率不匹配**：`DesktopLyricsState` 约 4Hz（见 §5.3），而歌词设置变化极低频；捆绑会导致不变的设置被反复重发。
2. **播种时机不同**：设置只需在"开窗时"与"变更时"各发一次；播放快照需持续推送。
3. **不能依赖 localStorage 直读**：桌面歌词窗口读 `store_settings`（`settings.store.ts:2875`）依赖"多窗口共享 localStorage origin"，而这对 `file://` 是**【待确认】**（§2.1）。故必须经 IPC 显式推送。
4. `lyrics.sources` / `enableNeteaseTranslation` 已镜像到**主进程 electron-store**（`use-sync-settings-to-main` → `settings/index.ts`），远程歌词获取（`lyric-by-song` 读 `store.get('lyrics')`）本身跨进程可用；但 `lyricsDisplay`（字号/间距等）与 `lyrics.fetch/preferLocalLyrics` 只在渲染层 `store_settings`，**必须**随 config 推送。

> 精确的 config 子集在实现期最终确定（哪些字段桌面歌词渲染真正需要），此处为草案。

## 5. 状态同步策略

### 5.1 开窗瞬间（避免等待下一次变化）

主进程打开窗口后，等桌面歌词窗口 `webContents` 触发 `did-finish-load`，再向主窗口 renderer 发 `desktop-lyrics-window-state {open:true}`。主窗口 renderer 收到后**立即**用 `getState()` 读取当前值并推一次完整快照：

- `usePlayerStoreBase.getState().getCurrentSong()`（`player.store.ts:771-782`）→ `song`
- `usePlayerStoreBase.getState().player.status` → `status`
- `useSettingsStore.getState().playback.type` → `playbackType`
- `useTimestampStoreBase.getState().timestamp` → `timestamp`
- `useSettingsStore.getState().lyrics / .lyricsDisplay` → `config`

由于是"读当前值推全量"，无需等待下一次状态变化，也避免了 renderer 未加载导致的初始快照丢失。

### 5.2 持续同步（组合现有 subscribe）

主窗口 renderer 在 `open:true` 期间订阅并推送：

| 订阅 | 触发 | 推送到 |
| --- | --- | --- |
| `subscribeCurrentTrack`（`player.store.ts:1853-1879`，按 `_uniqueId` 判等） | 切歌 | `desktop-lyrics-state` |
| `subscribePlayerStatus`（`player.store.ts:1951-1960`） | 播放/暂停/停止 | `desktop-lyrics-state` |
| `subscribePlayerProgress`（`timestamp.store.ts:45-59`，`a===b` 判等） | 进度变化 | `desktop-lyrics-state` |
| `useSettingsStore.subscribe` 监听 `lyrics`/`lyricsDisplay` 切片 | 歌词设置变化 | `desktop-lyrics-config` |

### 5.3 timestamp 频率分析

- **实际更新频率 ~250ms（4Hz）**：引擎侧 `web-player-engine.tsx:341/367` `progressInterval=250`、`mpv-player-engine.tsx:39/270` `PROGRESS_UPDATE_INTERVAL=250`，二者都调 `setTimestamp` 写入 timestamp store。
- `timestamp.store.ts:6/79` 的 `PLAYER_TIMESTAMP_POLL_INTERVAL_MS=500` 只是 `usePlayerTimestamp` hook 的**轮询兜底**，不是 timestamp 的更新源。
- **结论**：
  1. **不需要额外节流**——4Hz × 一条小消息（几十字节）可忽略；`subscribePlayerProgress` 已用 `equalityFn: a===b`（`timestamp.store.ts:54-56`）去重，不会重复发相同值。
  2. **必须在窗口关闭时停止同步**——通过 `desktop-lyrics-window-state {open:false}` 门控，避免无人接收时的空推。
  3. **无需再手动比较前后值**——去重已由 `subscribeWithSelector` 的 `equalityFn` 保证。
  4. （可选，非 MVP 必需）如后续觉得 4Hz 偏高，可在主窗口 renderer 侧按 ~250ms 做一次 `throttle`，但当前无需。

### 5.4 窗口关闭后

- 主窗口 renderer：收到 `desktop-lyrics-window-state {open:false}` 后**退订**四个订阅、停止推送。
- main：`desktopLyricsWindow` 置 `null`，移除 `ipcMain` 上的桌面歌词 handler（或按需保留入口 handler）。
- 桌面歌词 renderer：随窗口销毁而销毁，其 `desktopLyricsListener` 监听由 preload 的 remove 语义随进程回收。

### 5.5 主窗口关闭后

- 主窗口 `closed`（`main/index.ts:791-796`）会把 `mainWindow=null`。桌面歌词此时失去权威源。
- **设计：主窗口销毁即关闭桌面歌词窗口。** 在桌面歌词模块开窗时注册 `getMainWindow()?.once('closed', () => closeDesktopLyricsWindow())`，关窗时移除该监听。这**无需修改 `main/index.ts`**。
- 非 macOS：`window-all-closed` 会 `app.quit()`（`main/index.ts:1070-1079`）——即便桌面歌词未关也会被进程退出带走；macOS：靠上面的 `once('closed')` 主动关闭，避免孤儿窗口。
- **不允许孤儿窗口存在**：桌面歌词是无主 mirror，主窗口销毁后继续存活只有空壳。

## 6. BrowserWindow 生命周期

```
toggle-on（settings）
  → desktopLyrics.toggle() → ipcMain.handle('desktop-lyrics-toggle')
  → desktopLyricsWindow 存在且未销毁 ? focus/show : createWindow
create：
  new BrowserWindow({ frame:false, transparent:true, alwaysOnTop:true, resizable:false,
                      skipTaskbar:true, hasShadow:false, show:false,
                      webPreferences:{ contextIsolation:true, nodeIntegration:false, sandbox:true,
                                       preload: join(__dirname,'../preload/index.js') } })
  → loadFile('../renderer/desktop-lyrics.html')
  → 注册 webContents 'did-finish-load' → 发 window-state {open:true}
  → show()
  → getMainWindow()?.once('closed', closeDesktopLyricsWindow)
close（桌面歌词 renderer 发 control.close / settings toggle-off / 主窗口 closed）
  → 移除 mainWindow 'closed' 监听 → 发 window-state {open:false} → desktopLyricsWindow.destroy()
'closed' / 'destroyed'
  → desktopLyricsWindow = null → 移除 ipcMain handler（清理）
```

- **重复点击不会创建多窗口**：`toggle`/`open` 先检查 `desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()`，是则 `show()/focus()`，否则才 `new BrowserWindow`。单引用 + 判空是唯一的幂等保障，**不引入通用 WindowManager**（本 PR 只有一个第二窗口，不满足抽象门槛）。
- **app quit**：`before-quit`/`window-all-closed` 会关闭所有窗口；桌面歌词模块只需在 `closed` 里置空引用、移除 listener，无需额外退出逻辑。

## 7. Renderer Entry（独立 renderer）

- **HTML entry**：`src/renderer/desktop-lyrics.html`（参照 `index.html`：`<div id="root">` + `<script type="module" src="./desktop-lyrics/main.tsx">`，去掉 umami 脚本与 settings.js 注入）。
- **entry script**：`src/renderer/features/desktop-lyrics/main.tsx`（`createRoot(...).render(<DesktopLyricsApp/>)`）。
- **root component**：`DesktopLyricsApp`，**不渲染** `PlayerProvider` / `AudioPlayers` / `AppRouter`。
- **为什么不能复用 `AppShell`**：`AppShell` 无条件挂载 `PlayerProvider → AudioPlayers`（`app.tsx:100-103`），复用会 spawn 第二套播放引擎。桌面歌词必须是**无播放引擎**的纯镜像渲染。
- **目录结构（建议）**：
  ```
  src/renderer/features/desktop-lyrics/
    main.tsx                # 入口：createRoot
    DesktopLyricsApp.tsx    # 根组件（不含播放引擎）
    use-desktop-lyrics-bridge.ts   # 桌面歌词侧：接收快照 → seed 本地 store；发 control
  src/main/features/core/desktop-lyrics/
    index.ts                # 窗口生命周期 + ipcMain handler
  src/preload/desktop-lyrics.ts   # desktopLyrics（send 控制）+ desktopLyricsListener（on 接收）
  src/shared/types/desktop-lyrics.ts # 快照/配置/控制类型
  ```
- **与主 App 的隔离**：桌面歌词渲染进程有自己的 store 实例（无跨进程共享）。它把收到的快照**seed 进本地 store 的最小切片**（`setTimestamp(timestamp)`、`usePlayerStoreBase.setState({ player: { status } })`、`useSettingsStore.setState({ lyrics, lyricsDisplay })`），从而让现有 `SynchronizedLyrics`（直接读这些 store，`synchronized-lyrics.tsx:134/190-226`、`use-synchronized-lyrics-base.ts:28-32`）可原样复用——但这是**歌词渲染阶段**的细节，本阶段只确认"seed 本地 store 是复用前提"。
- **主窗口侧桥接**：`use-desktop-lyrics-main-bridge.ts`（挂在主窗口，见 §8 第 3 条）负责"订阅 → 推送"与"监听 seek → `mediaSeekToTimestamp`"。

## 8. File Changes

### New files

1. `src/shared/types/desktop-lyrics.ts` — 快照/配置/控制类型（§4 草案）。
2. `src/main/features/core/desktop-lyrics/index.ts` — 窗口创建/关闭/toggle、`ipcMain` handler、状态与 seek 转发。
3. `src/preload/desktop-lyrics.ts` — `desktopLyrics`（open/close/toggle/sendControl）+ `desktopLyricsListener`（onState/onConfig/onWindowState/onSeek）。
4. `src/renderer/desktop-lyrics.html` — 第二 renderer HTML 入口。
5. `src/renderer/features/desktop-lyrics/main.tsx` + `DesktopLyricsApp.tsx` + `use-desktop-lyrics-bridge.ts` — 桌面歌词 renderer。
6. `src/renderer/features/desktop-lyrics/use-desktop-lyrics-main-bridge.ts` — 主窗口侧桥接（推送 + seek 监听）。

### Existing files to modify（每个都说明"不改会怎样"）

1. **`electron.vite.config.ts`** — renderer 增加 `build.rollupOptions.input`（`index` + `desktop-lyrics`）。
   - 不修改的后果：renderer 仍是单入口（`electron.vite.config.ts:53-88` 无 `input`），`desktop-lyrics.html` 不会被打包产出，桌面歌词窗口无页面可加载。
2. **`src/main/features/core/index.ts`** — 增加 `import './desktop-lyrics';`。
   - 不修改的后果：desktop-lyrics 主模块（窗口 + IPC）不会被注册执行，开窗/控制/转发全部失效。这与 `settings`/`lyrics`/`player` 的注册方式一致（`core/index.ts:1-9`）。
3. **`src/renderer/app.tsx`** — 在主窗口挂载一个无 UI 的桥接组件（`use-desktop-lyrics-main-bridge`，放 `AppEffects` 或 `AppShell` 内）。
   - 不修改的后果：主窗口渲染进程没有代码把权威播放状态推给桌面歌词，也没有代码监听 seek——状态同步与 seek 控制彻底断链。
4. **`src/preload/index.ts`** — `api` 对象增加 `desktopLyrics`、`desktopLyricsListener` 两项（含 import）。
   - 不修改的后果：桌面歌词 renderer 无法类型安全地发送控制、也无法接收快照（通用 `ipc` 无 `on`，见 §0）。

> **不需要修改**：`src/main/index.ts`（桌面歌词窗口在独立模块创建，用 `getMainWindow()` 取主窗口，主窗口 `closed` 监听在开窗时注册）、`player.store.ts`、`timestamp.store.ts`、`settings.store.ts`、`use-main-player-listener.tsx`、`preload/mpv-player.ts`（play/pause/next/prev 复用已有 `renderer-player-*`）、`lyrics-api.ts`/`lyrics-utils.ts`（复用不修改）、`package.json`。

## 9. Dependency

**无需任何 `package.json` / lockfile 变化。** 所有依赖（Electron、React、zustand、React Query、idb-keyval）均已存在；透明/置顶/穿透全部是 Electron 内置 API（`BrowserWindow` 选项 + `setIgnoreMouseEvents` + `setAlwaysOnTop`）。

## 10. Risks

| 风险 | 分析 | 缓解 |
| --- | --- | --- |
| **IPC race condition** | 开窗瞬间快照可能早于桌面歌词 renderer 加载完成而丢失 | 主进程在 `did-finish-load` 后才发 `window-state {open:true}`，再触发主窗口推全量（§5.1） |
| **duplicate listener** | 主窗口桥接组件若被多次挂载会重复订阅/重复 `ipcMain.on` | 桥接组件单例挂载 + `subscribe*`/`desktopLyricsListener` 返回的 unsubscribe 在 effect cleanup 中调用；主进程 handler 幂等 |
| **window lifecycle** | 主窗口关闭 → 孤儿桌面歌词；或重复开窗多实例 | 开窗注册 `getMainWindow()?.once('closed', close)`；开窗前判 `isDestroyed`；`closed` 置空引用并清 listener（§6） |
| **timestamp synchronization** | 4Hz 推送频率 / 快照时序 | 已由 `equalityFn` 去重 + `open` 门控；单位统一为秒；无需节流（§5.3） |
| **seek** | 直连 mpv 会绕过 web 后端、脱同步 | 统一转发 `mediaSeekToTimestamp`（§3 控制方向） |
| **multi-monitor** | 窗口定位/记住上次位置 | 与主窗口一致复用 electron-store 存 `bounds`（`main/index.ts:643/808` 已有先例）；位置记忆是实现期细节 |
| **transparent window** | Linux 部分合成器下 `transparent:true` 可能不透明/异常 | **【待确认】**（运行时行为）；需按平台降级（如 Linux 给不透明底色）。Windows/macOS 正常 |
| **mouse penetration** | `setIgnoreMouseEvents(true, {forward:true})` 的 `forward` 仅在 Windows/macOS 生效，Linux 忽略 | **【待确认】**（运行时行为）；锁定时平台差异需在实现期验证 |
| **cross-platform** | 透明 + 穿透 + alwaysOnTop 三平台行为不一致 | 集中封装在 `desktop-lyrics` 主模块的窗口创建处，便于按 `process.platform` 分支 |

## 11. PR Review Risk（站在 maintainer 视角）

1. **最可能被要求修改**：桌面歌词窗口直接放在 `src/main/features/core/desktop-lyrics/` 是否符合仓库"feature 注册"惯例——需在 PR 描述里明确"为什么放这里而非 `main/index.ts`"（答案：与 `settings`/`lyrics`/`player` 一致，且不触碰 `createWindow`）。
2. **preload 新增 `desktopLyrics.ts` 而非给 `ipc.ts` 加 `on`**——maintainer 可能问"为什么不直接加一个通用 `on`"。需说明：仓库刻意不为通用 `ipc` 提供 `on`（只给 `removeAllListeners/removeListener/send`，`ipc.ts:15-19`），命名监听对象（`mpvPlayerListener` 先例）才是既有约定。
3. **为什么 seek 要新增 `desktop-lyrics-seek` 通道**——需引用 §3 的控制方向结论（`renderer-player-*` 无 seek、直连 mpv 会破坏 web 后端）。
4. **`DesktopLyricsConfig` 的字段子集**——最可能被质疑"为什么这些字段"。实现期要把每个字段映射到 `LyricsSettingsSchema`/`LyricsDisplaySettingsSchema`（`settings.store.ts:611-640`）给出取舍理由。
5. **不引入 WindowManager 的正当性**——需说明单窗口不满足抽象门槛（§6），符合"最小侵入"。
6. **跨平台透明/穿透的降级策略**——maintainer 大概率会盯 Linux 行为；需在实现期实测并文档化降级路径。
7. **"开窗瞬间快照丢失"的处理**——`did-finish-load` 门控是否足够，可能被要求在桌面歌词 renderer 增加"挂载后主动请求一次状态"的兜底。
8. **主窗口关闭 → 桌面歌词关闭的耦合**——"主窗口销毁即关桌面歌词"是否过于激进（是否应允许桌面歌词在 macOS 上继续留存）。这是**产品行为**，需在实现前与 maintainer 确认（对应第一阶段 §4 的"不早决定"项）。

---

> 本阶段只完成方案设计，未修改业务代码、未创建任何实现文件。下一阶段（实现）前，需先确认 §4 的 config 字段子集与 §11 第 8 条的产品行为。

---

## Implementation Progress

### Phase 3 — Window Foundation（窗口与生命周期基础，不含播放器/歌词接入）

本阶段只实现「桌面歌词窗口本身」：BrowserWindow 创建、开/关/切换、锁/解锁（鼠标穿透）、独立 renderer entry、preload/IPC 桥接。**明确不接入**播放器状态、歌词、播放/暂停/上下曲/seek、歌词控制栏、设置持久化。

#### 已完成

1. **主进程窗口模块** `src/main/features/core/desktop-lyrics/index.ts`
   - `BrowserWindow` 配置：`frame:false, transparent:true, alwaysOnTop:true, resizable:false, skipTaskbar:true, hasShadow:false, show:false` + 与主窗口一致的 `webPreferences`（`contextIsolation:true, nodeIntegration:false, sandbox:true, preload: join(__dirname,'../preload/index.js')`）。
   - 单引用 `desktopLyricsWindow` + `isDestroyed()` 判空，重复 `open`/`toggle` 不会创建多窗口。
   - 生命周期：`ready-to-show` → `show()`；`closed` → 置空引用并清理监听。
   - 主窗口关闭联动：开窗时 `getMainWindow().on('closed', closeDesktopLyricsWindow)`，关窗时 `removeListener` 移除，避免孤儿窗口与悬挂监听。
   - IPC：`ipcMain.handle('desktop-lyrics-open' / '-close' / '-toggle')` + `ipcMain.on('desktop-lyrics-lock' / '-unlock')`（模块顶层注册一次，随 app 存活，无需按窗口清理）。
   - 锁/解锁：`setIgnoreMouseEvents(locked, { forward: true })`。

2. **preload 桥接** `src/preload/desktop-lyrics.ts`
   - 导出 `desktopLyrics`：`open/close/toggle`（`invoke`）+ `lock/unlock`（`send`）。
   - 在 `src/preload/index.ts` 的 `api` 对象登记 `desktopLyrics`（沿用 `mpvPlayer` 命名监听对象惯例，非通用 `ipc.on`）。

3. **独立 renderer entry**
   - `src/renderer/desktop-lyrics.html`（无 umami、无 EJS 注入）。
   - `src/renderer/features/desktop-lyrics/main.tsx`（`createRoot` 渲染根组件，**无** `PersistQueryClientProvider`/`PlayerProvider`/`AudioPlayers`/`AppRouter`）。
   - `src/renderer/features/desktop-lyrics/desktop-lyrics-app.tsx` + `desktop-lyrics.css`（占位：可拖拽区 + "Desktop Lyrics" 文案 + Close 按钮 + Lock 按钮）。
   - `electron.vite.config.ts` 的 renderer `build.rollupOptions.input` 增加 `index` + `desktop-lyrics` 双入口。

4. **注册** `src/main/features/core/index.ts` 增加 `import './desktop-lyrics';`（与 `settings`/`lyrics`/`player` 一致，未触碰 `src/main/index.ts`）。

#### 未完成（按计划延后，非遗漏）

- 播放器/时间戳桥接（`desktop-lyrics-state` 快照、`subscribeCurrentTrack` 等订阅 → 推送）。
- 歌词设置快照（`desktop-lyrics-config`）。
- 控制动作转发（`desktop-lyrics-control`：play/pause/next/prev/seek）与 `desktop-lyrics-seek`。
- 歌词渲染（`SynchronizedLyrics` 复用）。
- 主窗口侧桥接组件 `use-desktop-lyrics-main-bridge.ts`（`app.tsx` 挂载）。
- 设置项、持久化、窗口位置记忆（`bounds`）。

#### 已验证（本机 Windows 环境）

- `pnpm run typecheck`（node + web）通过。
- `pnpm run lint-code`（eslint `--max-warnings=0` 全量）通过。
- `pnpm run lint-styles`（stylelint 全量）通过。
- `pnpm run build:electron` 通过，产物 `out/renderer/desktop-lyrics.html` 正常生成（结构正确，脚本/样式被正确注入），`out/main/index.js` 含全部 5 个 `desktop-lyrics-*` 通道。

#### 未验证（运行时行为，需人工实测）

- `transparent:true` 在 Linux 部分合成器下可能不透明 —— 见 §10 风险。
- `setIgnoreMouseEvents(locked, { forward:true })` 的 `forward` 仅 Windows/macOS 生效，Linux 忽略。
- `ready-to-show` 在透明窗口上的触发时机（选用它而非 `did-finish-load` 的理由：与主窗口 `main/index.ts:732` 一致，且避免透明窗口未绘制即 `show` 的闪屏；如实测发现透明窗口下不触发，需回退为 `did-finish-load` 或加兜底）。
- 三平台 `show()` 是否会抢占主窗口焦点（当前刻意不调 `focus()`，避免抢焦点；锁定时穿透本就不抢焦点）。

#### 实现期偏离设计的记录

1. **dev 加载 URL 用模板串而非 `path.join`**：`join(ELECTRON_RENDERER_URL, 'desktop-lyrics.html')` 在 Windows 会得到 `\` 分隔的非法 URL，故用 `` `${process.env['ELECTRON_RENDERER_URL']}/desktop-lyrics.html` ``；生产 `loadFile` 仍用 `join(__dirname, '../renderer/desktop-lyrics.html')`（文件路径，`\` 正确）。
2. **主窗口关闭联动用 `on('closed')` + 手动 `removeListener`，而非 `once('closed')`**：桌面歌词先关时 `once` 监听会悬挂，手动移除更干净。
3. **组件文件名用 kebab-case `desktop-lyrics-app.tsx`（导出 `DesktopLyricsApp`），非设计稿的 `DesktopLyricsApp.tsx`**：仓库组件文件均为 kebab-case（`item-card.tsx`、`drag-preview.tsx` 等），遵循既有约定。
4. **锁定的固有交互限制**：`setIgnoreMouseEvents(true)` 后窗口对点击穿透，占位里的 "Lock" 按钮点击后无法再从窗口内点 "Unlock"（这正是桌面歌词"锁定=不拦截鼠标"的语义）。解锁入口（主窗口控制 / 悬停展开交互条）留待接入阶段实现；当前可通过重启或 `window.api.desktopLyrics.unlock()`（DevTools 控制台）验证解锁。

### Phase 4 — Playback State Bridge（主窗口 renderer → main → 桌面歌词 renderer 播放状态同步）

本阶段只实现**播放状态单向同步**：主窗口 renderer 作为唯一权威源，把 `currentSong / status / timestamp / playbackType` 推送给桌面歌词 renderer（只读镜像）。**明确不实现**：播放/暂停/上下曲/seek 控制、`desktop-lyrics-config`、歌词渲染、控制栏、字体/配色等正式视觉。

#### 已完成

1. **共享类型** `src/shared/types/desktop-lyrics.ts`（新建）
   - `DesktopLyricsSong`：`Song` 的**最小子集** `{ album, artistName, duration, imageUrl, name }`。
   - `DesktopLyricsState`：`{ playbackType, song, status, timestamp }`（键按字母序，满足 `perfectionist/sort-objects`）。
   - `DesktopLyricsWindowState`：`{ open: boolean }`。

2. **主进程转发 + 门控** `src/main/features/core/desktop-lyrics/index.ts`
   - `ipcMain.on('desktop-lyrics-state', (_e, state) => ...)`：把主窗口 renderer 发来的快照原样转发给桌面歌词窗口 `webContents.send('desktop-lyrics-state', state)`，转发前用 `desktopLyricsWindow === null || isDestroyed()` 判空，**不检查/不改造 payload**。
   - `notifyMainWindowState(open)`：向 `getMainWindow().webContents` 发 `desktop-lyrics-window-state {open}`。
   - 门控用 `window.webContents.on('did-finish-load', () => notifyMainWindowState(true))`；`window.on('closed', ...)` 里追加 `notifyMainWindowState(false)`。

3. **preload** `src/preload/desktop-lyrics.ts`
   - `desktopLyrics` 增加 `sendState(state)`（`ipcRenderer.send('desktop-lyrics-state', state)`）。
   - 新增 `desktopLyricsListener`：`onState(cb)` / `onWindowState(cb)`，均返回**退订函数**（`ipcRenderer.removeListener`），供主窗口 bridge 在 close/unmount 时清理。
   - `src/preload/index.ts` 的 `api` 对象登记 `desktopLyricsListener`（紧随 `desktopLyrics`）。

4. **主窗口侧桥接** `src/renderer/features/desktop-lyrics/use-desktop-lyrics-main-bridge.ts`（新建）
   - `useDesktopLyricsBridge()` hook：`useEffect` 内订阅 `desktopLyricsListener.onWindowState`。
   - `open:true` → `startSync()`：**先 `stopSync()` 再**订阅 `subscribeCurrentTrack` / `subscribePlayerStatus` / `subscribePlayerProgress`，每次变化都 `pushState()`（用 `getState()` 读当前值，构造完整快照），并立即 `pushState()` 一次作为初始快照。
   - `open:false` / unmount → `stopSync()`：`while (unsubscribers.length) unsubscribers.pop()?.()` 清空全部订阅；effect cleanup 同时 `removeWindowStateListener()`。
   - `pushState()` 读取：`usePlayerStoreBase.getState().getCurrentSong()`（→ `toDesktopLyricsSong` 映射最小字段）、`.player.status`、`useSettingsStore.getState().playback.type`、`useTimestampStoreBase.getState().timestamp`。
   - `app.tsx` 的 `AppEffects` 挂载 `<DesktopLyricsBridgeEffect />`（无 UI，`useDesktopLyricsBridge()` + `return null`），与其它 effect 一致。

5. **桌面歌词侧镜像** `src/renderer/features/desktop-lyrics/desktop-lyrics.store.ts`（新建）
   - `useDesktopLyricsStore = create<DesktopLyricsState>(...)`，纯**显示用镜像**，无 `persist`，不构成第二玩家状态。
   - **模块顶层**注册 `desktopLyricsListener.onState((state) => useDesktopLyricsStore.setState(state))`——保证 `did-finish-load` 门控触发前监听已就位（消除初始快照竞态），且桌面歌词是独立 renderer 进程，随窗口销毁即回收，无跨窗口重复。
   - `desktop-lyrics-app.tsx` 改为 debug 面板：显示 `Song / Status / Timestamp / Playback Type`（读取镜像 store），保留 Close/Lock 按钮；`desktop-lyrics.css` 增加 `.desktop-lyrics-debug`。

#### IPC 通道（本阶段实际实现，仅 2 条数据通道）

| Channel | 方向 | Payload | 触发 |
| --- | --- | --- | --- |
| `desktop-lyrics-state` | 主窗口 renderer → main → 桌面歌词 renderer | `DesktopLyricsState` | 开窗初始快照 + 持续变化（切歌/状态/进度） |
| `desktop-lyrics-window-state` | main → 主窗口 renderer | `DesktopLyricsWindowState {open}` | `did-finish-load`（true） / `closed`（false） |

> 未实现 `desktop-lyrics-config` / `desktop-lyrics-control` / `desktop-lyrics-seek`（按计划延后到歌词/控制阶段）。

#### 实际同步频率（源码确认，非假设）

`subscribePlayerProgress` 订阅 timestamp store（`timestamp.store.ts:45-59`，`equalityFn: a===b`），只在值**真正变化**时触发，`setTimestamp` 的写入源为各引擎：

| 引擎 | 源码位置 | 间隔 | 频率 |
| --- | --- | --- | --- |
| WEB（react-player） | `web-player-engine.tsx:341/367` `progressInterval={isTransitioning ? 10 : 250}` | 250ms | ~4Hz（crossfade 过渡 10ms） |
| MPV | `mpv-player-engine.tsx:39` `PROGRESS_UPDATE_INTERVAL=250`、`:270` | 250ms | ~4Hz |
| WAVESURFER | `wavesurfer-player-engine.tsx:154/175` `setInterval(..., isTransitioning ? 10 : 250)` | 250ms | ~4Hz |
| JUKEBOX | `jukebox-player-engine.tsx:383` `setInterval(..., 1000)` | 1000ms | ~1Hz |

- 结论：WEB/MPV/WAVESURFER 约 4Hz、JUKEBOX 约 1Hz；timestamp 单位为**秒（float）**，与 timestamp store 一致（`timestamp.store.ts:35` 默认 0）。
- `timestamp.store.ts:6/79` 的 `PLAYER_TIMESTAMP_POLL_INTERVAL_MS=500` 只是 `usePlayerTimestamp` 的**轮询兜底**，非更新源，本阶段**未**使用。
- 本阶段**未**创建 `setInterval`、**未**轮询播放器，全部复用现有 `subscribe*`（符合"不重复轮询"约束）。

#### 生命周期 cleanup

- 主窗口 bridge：`startSync()` 前先 `stopSync()`（防 rapid open/close/open 重复订阅）；`open:false` 与 unmount 均 `stopSync()` + `removeWindowStateListener()`。
- main：`closed` → `notifyMainWindowState(false)`；主窗口关闭联动（Phase 3 的 `on('closed', closeDesktopLyricsWindow)`）保持，桌面歌词随之销毁。
- 桌面歌词 renderer：镜像监听在模块顶层注册一次，随窗口进程销毁，无残留。

#### 测试结果

**静态检查全部通过**（本机 Windows）：
- `pnpm run typecheck`（node + web）通过。
- `pnpm run lint-code`（eslint `--max-warnings=0`）通过。
- `pnpm run lint-styles`（stylelint）通过。
- `pnpm run build:electron` 通过，`out/renderer/desktop-lyrics.html` 正常生成（`<script>` 指向 `desktop-lyrics-*.js`，样式注入正常）。

**运行时 11 场景（待人工实测，本阶段未跑 dev 实例）**：
1. 打开即有当前歌曲；2. 播放中 timestamp 变化；3. 暂停更新 status；4. 恢复；5. seek 后 timestamp 更新；6. 上/下一首更新 song；7. 无残留旧歌；8. 关闭停止发送；9. 快速开/关无重复订阅；10. renderer reload 无重复监听；11. 主窗口关闭停止同步。

#### 未解决问题

- 11 个运行时场景需在 `pnpm dev` 下人工验证（尤其场景 9/10 的重复订阅、场景 11 的主窗口关闭联动）。
- `transparent` / `setIgnoreMouseEvents` 三平台差异、透明窗口下 `did-finish-load` 触发时机（Phase 3 遗留的运行时项）延续。
- 歌词阶段需决定：桌面歌词渲染复用 `SynchronizedLyrics` 时，是继续用独立镜像 store 还是按 §7 原方案 seed 进 `usePlayerStoreBase`/`setTimestamp`（本阶段为"只显示状态"，采用独立 store，未 seed）。

#### 与 Phase 2 设计的偏差记录

1. **`song` 用最小子集 `DesktopLyricsSong` 而非 `QueueSong`**：§4 草案 `song: QueueSong | undefined` 会携带 `lyrics`/`participants`/`tags`/`genres` 等大字段；按"只发真正最小字段"改为 `DesktopLyricsSong`（`{ album, artistName, duration, imageUrl, name }`），IPC payload 更小。
2. **门控与 show 分离**：§5.1/§6 的门控用 `did-finish-load`（一致），但 Phase 3 的 `show()` 仍用 `ready-to-show`（未改）。二者职责不同：`show()` 用 `ready-to-show`（避免透明窗口未绘制即 show 闪屏，与主窗口 `main/index.ts:732` 一致）；同步门控用 `webContents.on('did-finish-load')`（保证 renderer 模块脚本已执行、镜像监听已注册）。注意 `did-finish-load` 是 `webContents` 事件（非 `BrowserWindow`），故写 `window.webContents.on(...)`。
3. **`DesktopLyricsWindowState` 抽成类型**：§3 表格用内联 `{open:boolean}`，实现期抽为共享类型供 preload/main/renderer 三端复用。
4. **桌面歌词镜像用独立 store，未按 §7 原方案 seed 进 player/timestamp store**：§7 提出"seed 进 `usePlayerStoreBase.setState({player:{status}})`、`setTimestamp`"以复用 `SynchronizedLyrics`；本阶段只显示状态、不渲染歌词，故用独立 `desktop-lyrics.store.ts`（`create<DesktopLyricsState>`，无 persist），避免第二玩家状态；歌词阶段再决定是否改用 seed 方案。
5. **命名沿用 kebab-case**：`desktop-lyrics.store.ts`、`use-desktop-lyrics-main-bridge.ts`、`desktop-lyrics-app.tsx`；§7 的 `DesktopLyricsApp.tsx` / `use-desktop-lyrics-bridge.ts` 未采用（与 Phase 3 记录一致）。

### Phase 5 — Lyrics Integration（歌词获取/解析/同步/高亮/翻译/切歌/暂停/seek/空状态）

本阶段把现有歌词系统接入桌面歌词窗口，实现：歌词获取、解析、同步歌词、当前行高亮、翻译/副歌词（若数据提供）、切歌同步、暂停/恢复/seek 同步、无歌词空状态。**明确不实现**（推迟 Phase 6）：控制栏（播放/暂停/上下曲）、锁定/解锁 UI、关闭按钮 UI、字体/配色设置、设置入口、Desktop Lyrics 开关。

#### 采用的复用方案（§1 方案 A/B 结论）

**选择 方案 B：复用「获取/解析/定位」逻辑，自建极简渲染层。**

- **方案 A（直接复用 `SynchronizedLyrics` 组件）被否决**。原因：`SynchronizedLyrics` → `useSynchronizedLyricsBase` → `useLyricsAnimationEngine` 链重度依赖主窗口模块级 store：`usePlayerStoreBase.getState().player.status`、`useTimestampStoreBase.getState().timestamp`、`usePlaybackType()`/`useLyricsSettings()`/`useLyricsDisplaySettings()`（settings store）、`usePlayerActions().mediaSeekToTimestamp`，且 `handleSeek` 直接调 `mpvPlayer.seekTo`/`mpris`。在桌面歌词 renderer（独立进程）里这些 store 均为**空实例**，直接复用需 seed/fake 3+ 个主窗口 store + 拉入 DOM 强耦合动画引擎 + Mantine（`Box`/`Stack`）+ 点击 seek 的耦合——正是约束里"大量 seed/fake 现有 player store"要规避的。
- **方案 B**：歌词**获取与解析放在主窗口 renderer**（唯一拥有 server 列表、settings、React Query 的地方），复用 `lyricsQueries.songLyrics` + `computeSelectedFromResult` + `getLyricsLayers` + `getDisplayOffset` + `normalizeLyrics` + `findOverlayLineByTime` + `getCurrentLyricIndex`（纯函数/既有查询，**不改动**）；把解析结果以**极简 payload** 经 IPC 发给桌面歌词 renderer；桌面歌词侧只做「镜像 + 当前行定位 + 渲染」，用 `getCurrentLyricIndex(lyrics, timestamp*1000 + offsetMs)` 定位当前行（与现有 `SynchronizedLyrics` 的 `tick` 底层同源），`findOverlayLineByTime` 取翻译/发音。

#### 实际修改文件

**新建**：
- `src/renderer/features/desktop-lyrics/use-desktop-lyrics-lyrics-bridge.ts`：主窗口侧歌词桥。订阅当前歌，500ms 防抖切歌（与 `lyrics.tsx` 一致），`useQuery(lyricsQueries.songLyrics(...))` 拉取，`computeSelectedFromResult` + `getDisplayOffset` + `getLyricsLayers` 解析出 `lyrics / offsetMs / translationLyrics / pronunciationLyrics`，经 IPC 推送；切歌/radio 激活立即清空（防 stale）。
- `src/renderer/features/desktop-lyrics/desktop-lyrics-lyrics.store.ts`：桌面歌词侧歌词镜像 store（`create<DesktopLyricsData>`，无 persist），模块顶层注册 `desktopLyricsListener.onLyrics`。

**修改**：
- `src/shared/types/desktop-lyrics.ts`：新增 `DesktopLyricsData { lyrics, offsetMs, pronunciationLyrics, translationLyrics }`（复用 `SynchronizedLyrics`，非新格式）；`DesktopLyricsState` 增加 `language`。
- `src/preload/desktop-lyrics.ts`：`desktopLyrics` 增 `sendLyrics`，`desktopLyricsListener` 增 `onLyrics`。
- `src/main/features/core/desktop-lyrics/index.ts`：新增 `ipcMain.on('desktop-lyrics-lyrics', ...)` 中继（与 `desktop-lyrics-state` 同模式，判空转发）。
- `src/renderer/features/desktop-lyrics/use-desktop-lyrics-main-bridge.ts`：`pushState` 追加 `language`。
- `src/renderer/features/desktop-lyrics/desktop-lyrics.store.ts`：初始 state 补 `language: 'en'`。
- `src/renderer/app.tsx`：`AppEffects` 挂载 `<DesktopLyricsLyricsBridgeEffect />`。
- `src/renderer/features/desktop-lyrics/desktop-lyrics-app.tsx`：由 debug 面板替换为歌词渲染（当前行高亮 + 翻译/发音 overlay + 空状态 + 平滑居中滚动 + i18n 语言同步）。
- `src/renderer/features/desktop-lyrics/desktop-lyrics.css`：删除 debug/close/lock 样式，新增歌词行/高亮/overlay/空状态样式。

**明确不修改**：`player.store.ts`、`timestamp.store.ts`、`settings.store.ts`（只读）；`synchronized-lyrics.tsx`、`use-synchronized-lyrics-base.ts`、`lyrics-animation-engine.ts`、`use-lyrics-animation-engine.ts`、`lyric-line.tsx`、`lyrics-scroll-content.tsx`（不复用，因耦合）；`lyrics.tsx`、`lyrics-api.ts`、`lyrics-utils.ts`（复用 import，不改动源码）。

#### 歌词数据流

主窗口 renderer（权威）→ `useDesktopLyricsLyricsBridge`：`usePlayerSong()` 当前歌 → 500ms 防抖 → `lyricsQueries.songLyrics`（React Query，与全屏歌词同 key，缓存共享/去重）→ `computeSelectedFromResult`/`getLyricsLayers`/`getDisplayOffset` 解析 → `DesktopLyricsData` → `window.api.desktopLyrics.sendLyrics` → main `desktop-lyrics-lyrics` 中继 → 桌面歌词 renderer `desktop-lyrics-lyrics.store` 镜像 → `DesktopLyricsApp` 渲染。

- 切歌：立即 `sendLyrics(EMPTY)` 清旧歌词 → 500ms 后拉新 → 推新歌词（避免 stale/race）。
- 空歌词/非同步歌词：`lyrics` 为 `undefined` → 空状态（`t('page.fullscreenPlayer.noLyrics')`）。
- 翻译/发音：来自 `getLyricsLayers(data.local).translation/.pronunciation`（仅 `StructuredLyric[]` 多结构化数据提供；单结构化/远程自动歌词无独立 overlay，行为与现有 Feishin 一致）。

#### 同步方式

- 时间源复用 Phase 4 的 `desktop-lyrics-state`（timestamp 秒），**不**再轮询/建第二时间源。
- 当前行 = `getCurrentLyricIndex(normalizedLyrics, timestamp*1000 + offsetMs)`（纯函数，线性扫描，空返回 -1）。
- 高亮：`index === activeIndex` 加 `.desktop-lyrics-line-active`（CSS 字号/加粗/变亮）。
- 滚动：`activeIndex` 变化时 `scrollIntoView({ behavior:'smooth', block:'center' })`（仅切行触发，非每 tick）。
- 暂停/恢复/seek：均体现在 `timestamp`/`status` 变化上（Phase 4 已由 `subscribePlayerStatus`/`subscribePlayerProgress` 驱动），渲染层被动跟随，无需特殊处理。
- 语言：`DesktopLyricsState.language` 随快照下发，桌面歌词侧 `i18n.changeLanguage(language)` 同步（空状态复用现有 i18n，不硬编码）。

#### 新增 IPC

| Channel | 方向 | Payload | 触发 |
| --- | --- | --- | --- |
| `desktop-lyrics-lyrics` | 主窗口 renderer → main → 桌面歌词 renderer | `DesktopLyricsData` | 切歌/歌词解析完成（独立于 4Hz state 快照，只在歌词变化时推） |

> 歌词与播放状态分离为两条通道：`desktop-lyrics-state` 4Hz 只推轻量播放字段；`desktop-lyrics-lyrics` 低频只推歌词（避免 4Hz 重复推送歌词数组）。

#### 是否需要新 store / 是否改 Phase 4 snapshot

- **新增一个独立镜像 store** `desktop-lyrics-lyrics.store.ts`（与 `desktop-lyrics.store.ts` 并列），因歌词变化频率（切歌/拉取）与 4Hz 播放状态不同，分 store 更清晰、避免 4Hz 重推歌词。
- **Phase 4 snapshot 仅做加法扩展**：`DesktopLyricsState` 增 `language`（供 i18n 复用），播放字段、门控、订阅逻辑均不变。

#### 与 Phase 2/4 的偏差记录

1. **歌词阶段采用「独立歌词镜像 store + 极简渲染」，未按 §7 原方案 seed player/timestamp store**：§7 设想 seed `usePlayerStoreBase`/`setTimestamp` 以复用 `SynchronizedLyrics`；实际评估后 `SynchronizedLyrics` 链耦合过重（settings store、`mpvPlayer.seekTo`、DOM 动画引擎、Mantine），故采用方案 B（复用纯逻辑 + 自建渲染），延续 Phase 4"独立镜像 store"路线。
2. **新增 `desktop-lyrics-lyrics` 通道**：§3 只规划了 config/control/state 等通道；歌词数据通道未在 §3 表格内，实现期新增，与 `desktop-lyrics-state` 分离（频率不同）。
3. **`DesktopLyricsState` 增 `language`**：§4 草案 snapshot 未含 language；为复用现有 i18n 空状态文案而追加（最小加法）。
4. **非同步歌词按"空状态"处理**：现有全屏歌词对非同步歌词走 `UnsynchronizedLyrics`（无高亮纯文本）；桌面歌词 MVP 未实现该分支（`lyrics` 仅在 `selectedSynced && Array.isArray` 时下发，否则空状态），纯文本渲染与逐字 karaoke 一并留待后续。

#### 已验证项目

**静态检查全部通过**（本机 Windows）：
- `pnpm run typecheck`（node + web）通过。
- `pnpm run lint-code`（eslint `--max-warnings=0`）通过。
- `pnpm run lint-styles`（stylelint）通过。
- `pnpm run build:electron` 通过。

#### 最终人工测试待测项目（运行时，本阶段未跑 dev 实例）

1. 有同步歌词的歌：开窗即渲染歌词、当前行高亮正确。
2. 播放中当前行随时间推进、平滑居中滚动。
3. 暂停时高亮停留；恢复后继续推进。
4. seek 后高亮/滚动跳到正确行。
5. 上/下一首：先清空→短暂空状态→新歌词（无 stale/错词）。
6. 快速连续切歌：不拉取中间曲目歌词、最终歌词正确。
7. 翻译/发音 overlay（多结构化歌词数据）正确显示。
8. 无歌词曲目：显示本地化空状态文案（随语言设置）。
9. 主窗口切换语言后，桌面歌词空状态文案跟随。
10. 非同步歌词曲目：当前按空状态处理（已知限制）。

### Phase 6A — Controls & Window Interaction（控制栏 + 窗口交互）

本阶段把桌面歌词从「只读歌词显示器」变为「可操作窗口」：播放/暂停、上一首/下一首、锁定、关闭、hover 控制栏、锁定鼠标穿透、解锁拖动、基础视觉整理。**明确不实现**：seek（点击歌词跳转）、Settings（字体/配色/设置入口/Desktop Lyrics 开关，延后 Phase 6B）。

#### 控制链（复用现有架构，零新增主窗口监听）

播放控制**完全复用**主窗口已有 `renderer-player-*` 通道 + `use-main-player-listener.tsx`：

```text
Desktop Lyrics renderer（控制栏按钮）
  → window.api.desktopLyrics.control({ type: 'toggle-play' | 'next' | 'previous' })
  → ipcRenderer.send('desktop-lyrics-control', action)
  → main（desktop-lyrics 模块 ipcMain.on('desktop-lyrics-control')）
  → getMainWindow().webContents.send('renderer-player-play-pause' | 'renderer-player-next' | 'renderer-player-previous')
  → 主窗口 renderer use-main-player-listener.tsx:51/57/69
  → mediaTogglePlayPause() / mediaNext(false) / mediaPrevious(false)
```

- **play/pause 采用单一 `toggle-play` intent**（转发到 `renderer-player-play-pause` → `mediaTogglePlayPause()`）。不暴露 `play`/`pause`/`play-pause` 三套，符合 §三「只暴露最小 intent」。
- **previous/next** 复用 `renderer-player-previous`/`renderer-player-next`（→ `mediaPrevious(false)`/`mediaNext(false)`），不新建。
- **不建立第二播放控制系统**：桌面歌词 renderer 不直接访问播放器、不调 mpv、不创建 player action、不改 player store。

#### 新增 IPC

| Channel | 方向 | Payload | 触发 |
| --- | --- | --- | --- |
| `desktop-lyrics-control` | 桌面歌词 renderer → main | `DesktopLyricsControlAction`（判别联合） | 控制栏按钮点击 |

`DesktopLyricsControlAction`（`src/shared/types/desktop-lyrics.ts`）：

```ts
export type DesktopLyricsControlAction =
    | { type: 'close' }
    | { type: 'lock' }
    | { type: 'next' }
    | { type: 'previous' }
    | { type: 'toggle-play' }
    | { type: 'unlock' };
```

main 分发：`toggle-play`/`next`/`previous` → `sendToMainWindow('renderer-player-*')`；`lock`/`unlock` → `setLocked(bool)`；`close` → `closeDesktopLyricsWindow()`。

**移除的通道**：`desktop-lyrics-lock`、`desktop-lyrics-unlock`（Phase 3 debug 面板专用，其唯一消费者已随 Phase 5 删除；控制栏的 lock/unlock 现统一走 `desktop-lyrics-control`）。`desktop-lyrics-open`/`-close`/`-toggle`（invoke，主窗口生命周期/Phase 6B 设置入口用）保留不变。

#### 修改文件

**新建**：
- `src/renderer/features/desktop-lyrics/desktop-lyrics-control-bar.tsx`：控制栏组件。5 个按钮（previous / play-pause / next / lock / close），图标用 `react-icons/ri`（`RiSkipBackFill`/`RiPauseFill`/`RiPlayFill`/`RiSkipForwardFill`/`RiLockFill`/`RiCloseLine`，复用项目既有图标库，非新依赖）。play/pause 图标由镜像 store 的 `status === PlayerStatus.PLAYING` 决定；按钮 `onClick` 调 `window.api.desktopLyrics.control(...)`。

**修改**：
- `src/shared/types/desktop-lyrics.ts`：新增 `DesktopLyricsControlAction`（判别联合，字母序：close/lock/next/previous/toggle-play/unlock）。
- `src/preload/desktop-lyrics.ts`：`desktopLyrics` 增 `control(action)`（`ipcRenderer.send('desktop-lyrics-control', action)`），删除孤儿 `lock`/`unlock`。
- `src/main/features/core/desktop-lyrics/index.ts`：新增 `sendToMainWindow(channel)` 助手 + `ipcMain.on('desktop-lyrics-control', ...)` 分发（switch，字母序 case）；删除 `desktop-lyrics-lock`/`-unlock` 两个 handler。
- `src/renderer/features/desktop-lyrics/desktop-lyrics-app.tsx`：新增 `locked` state + `handleLock`（`setLocked(true)` + `control({type:'lock'})`）；空状态与非空状态两处返回均条件渲染 `{!locked && <DesktopLyricsControlBar onLock={handleLock} />}`。
- `src/renderer/features/desktop-lyrics/desktop-lyrics.css`：新增控制栏/按钮/hover 样式；**移除 `.desktop-lyrics-root` 的 `rgb(0 0 0 / 40%)` 整窗底色**，改为歌词行 + 空状态 `text-shadow` 保可读性（满足 §十「透明背景 / 不添加大块不必要背景」）。

**明确不修改**：`player.store.ts`、`timestamp.store.ts`、`settings.store.ts`、`use-main-player-listener.tsx`、`preload/mpv-player.ts`（复用 `renderer-player-*`，零改动）。

#### lock/unlock 设计

- 锁状态由**桌面歌词 renderer 本地 state** 持有（`locked`，初始 `false`），因为锁只由控制栏按钮发起（6A 无外部解锁入口）。
- 点击 lock → `setLocked(true)` + `control({type:'lock'})` → main `setLocked(true)` → `setIgnoreMouseEvents(true, { forward: true })`（`forward` 保留 hover 事件但点击穿透，Windows/macOS 生效，Linux 忽略）。
- **锁定后控制栏随 `{!locked && ...}` 隐藏**：hover 不会「强制取消穿透」，整个窗口默认穿透，符合 §六「控制栏出现时不能破坏穿透语义」。
- **6A 为单向锁定**：锁定后窗口点击穿透，窗口内无法再点「解锁」（这正是桌面歌词「锁定=不拦截鼠标」的语义）。`unlock` intent 仍保留在类型与 main 分发中（前向兼容），**窗口内触发不到**；外部解锁入口（主窗口 Settings/开关，Phase 6B）延后。此为已知限制，非 bug。
- **未采用「临时假取消穿透」**：不给控制栏单独开鼠标事件区域（`setIgnoreMouseEvents` 是窗口级 OS 设置，无 per-region 例外；临时 toggle 会复杂化锁状态，§六明确禁止）。

#### hover 行为

- 控制栏揭示用 **CSS `:hover`**（`.desktop-lyrics-root:hover .desktop-lyrics-control-bar`），非 JS `mouseenter`/`mouseleave`——对 `-webkit-app-region: drag` 区域更稳健。
- 隐藏态：`opacity: 0` + `pointer-events: none`（不拦截鼠标，不破坏拖动）；hover 态：`opacity: 1` + `pointer-events: auto`。
- 空状态（无歌词）与正常态都渲染控制栏（close/lock 在无歌词时仍可用）。

#### drag 行为

- `.desktop-lyrics-root`：`-webkit-app-region: drag`（整窗可拖动，含歌词文字——§九「歌词文字是否 drag」选可拖）。
- `.desktop-lyrics-control-bar` + `.desktop-lyrics-control-button`：`-webkit-app-region: no-drag`（控制栏与按钮可点击，不触发拖动）。**未修改 Electron window manager**。

#### seek 流程（本阶段未实现，留档）

§五「点击歌词跳转」为条件项（「如果支持」），不在 §一 10 项范围，故**未实现**。将来加入时唯一正确路径（已确认，沿用 §3 结论）：

```text
Desktop Lyrics → desktop-lyrics-control {type:'seek', timestamp}
  → main → getMainWindow().webContents.send('desktop-lyrics-seek', {timestamp})
  → 主窗口 renderer 新监听器 → mediaSeekToTimestamp(timestamp)
```

**绝不** `mpvPlayer.seekTo()`：会绕过 timestamp store、破坏 WEB/JUKEBOX/WAVESURFER 后端统一。`renderer-player-*` 无 seek 通道，故将来需新增 `desktop-lyrics-seek`（主窗口侧唯一新增监听）。当前 `DesktopLyricsControlAction` 不含 `seek`。

#### 与 Phase 2 设计相比的变化

1. **`play`/`pause`/`play-pause` 三合一 → 单一 `toggle-play`**：§3 草案 `DesktopLyricsControlAction` 含 `play-pause`/`play`/`pause` 三个；实际只保留 `toggle-play`（§三「不要在 public IPC API 中同时存在 play/pause/play-pause」）。
2. **`seek` 移除**：§3 草案含 `{type:'seek', timestamp}`；实际未实现（§五条件项、§一范围外），故 `DesktopLyricsControlAction` 不含 `seek`，也未新增 `desktop-lyrics-seek` 通道。
3. **`desktop-lyrics-lock`/`-unlock` 通道删除**：Phase 3 为 debug 面板建的独立锁通道，其消费者已在 Phase 5 删除；控制栏 lock/unlock 统一并入 `desktop-lyrics-control`，避免冗余通道（§十一「不要保留已证明不需要的 action」）。
4. **控制栏 close 走 `desktop-lyrics-control {type:'close'}`**：与主窗口生命周期 `desktop-lyrics-close`（invoke，Phase 6B 设置入口用）语义区分——前者「窗口内关自己」，后者「主窗口关窗口」，二者都最终调 `closeDesktopLyricsWindow()`。
5. **`DesktopLyricsControlAction` 字母序**：close/lock/next/previous/toggle-play/unlock（满足 `perfectionist/sort-modules` 与 switch case 一致）。

#### 自动化验证（本阶段，未跑 dev 实例）

**静态检查全部通过**（本机 Windows）：
- `pnpm run typecheck`（node + web）通过。
- `pnpm run lint-code`（eslint `--max-warnings=0`）通过（`sort-modules` 由 `--fix` 校正 `DesktopLyricsControlAction` 置顶）。
- `pnpm run lint-styles`（stylelint `--max-warnings=0`）通过（recess-order 属性序已手排）。
- `pnpm run build:electron` 通过（46.71s）。

#### 尚待人工验证的问题（运行时，留待 Phase 6B 后）

1. hover 控制栏出现/消失（含 `-webkit-app-region: drag` 区域 `:hover` 是否可靠）。
2. 控制栏 previous/play-pause/next 是否经 `renderer-player-*` 正确驱动播放（主窗口播放器响应）。
3. play/pause 图标随 `status` 正确切换（暂停时显示 play、播放时显示 pause）。
4. close 按钮是否经 main `closeDesktopLyricsWindow()` 关闭，且 Phase 4 订阅停止、可再次 open。
5. 锁定后整窗鼠标穿透、歌词继续刷新、alwaysOnTop 保持；hover 不揭示控制栏。
6. 解锁入口（6A 无）——窗口内锁定后无法解锁，需 Phase 6B 外部入口；当前仅能重启或 DevTools 手动 `unlock` 验证。
7. 未锁定时整窗可拖动，控制栏/按钮 `no-drag` 可点击。
8. 移除整窗底色后歌词在亮色/复杂壁纸上的可读性（text-shadow 是否足够）。
9. Linux 下 `setIgnoreMouseEvents(true, {forward:true})` 的 `forward` 被忽略，锁定后 hover 不触发（预期）。
10. `react-icons/ri` 图标在桌面歌词独立 renderer（无 Mantine）下正常渲染、颜色为 `currentColor`（#fff）。
