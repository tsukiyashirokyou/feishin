# CLAUDE.md

> 本文件是 **Desktop Lyrics 项目历史上下文的落盘入口**，目标是让新的 Claude Code session
> 无需原始聊天记录即可快速恢复「已讨论到哪里、已决定什么、接下来遵守什么」。
> 详细源码级分析（含 `文件:行号` 依据）保留在 [`docs/desktop-lyrics-analysis.md`](docs/desktop-lyrics-analysis.md)，此处不重复。
>
> 内容来源：历史对话（已固化进 analysis doc）、`docs/desktop-lyrics-analysis.md`、当前源码。
> 标记 `[来源待确认]` 表示未能在历史/文档/源码中找到证据，不得视为既定事实。

---

# 1. Project Context

- 项目是 **Feishin**（Electron 音乐播放器）。
- 当前开发的是 **Desktop Lyrics**（桌面歌词窗口）功能：一个独立的、置顶/透明的歌词悬浮窗。
- 最终目标：主窗口播放时，桌面歌词窗口实时显示当前行高亮的同步歌词，并支持播放控制与窗口交互。
- 当前阶段：核心功能（窗口、状态桥、歌词、控制、设置入口）已实现并提交，处于**人工 runtime 验收**阶段。

# 2. Current Status

- 已完成 Phase：**3（Window Foundation）→ 4（Playback State Bridge）→ 5（Lyrics Integration）→ 6A（Controls & Window Interaction）→ 6B（Settings & Entry）→ 6C-1（Window / Control Bar / Lyrics Scroll UX Polish）**。
- Runtime Bug Fix Round 2（BUG-01/02/03/05 修复、BUG-04 调查结论、UX-01 记录）与 Phase 6C-1 均已实现、静态检查通过；**尚未提交、尚未跑 dev 实例**（runtime 待人工复核，§11）。
- 6C-1 落地项：锁定态 hover 解锁、窗口可缩放（默认 720×200、min 480×140）、`lineLeadTimeMs` 提前滚动、控制栏移到歌词上方、多显示器默认定位（跟随主窗口所在屏上方中央）。
- 未完成功能（显式延后，非遗漏）：点击歌词 seek、透明度/背景色/字体族/对齐/动画速度、窗口位置记忆（6C-1 仅默认定位、无持久化）、主题、逐字 karaoke、非同步歌词的纯文本渲染。
- 当前处于**人工验收阶段**：runtime 行为需在 `pnpm dev` 下人工复核，尚未跑 dev 实例（§11）。

# 3. Verified Architecture Facts

以下事实均经当前源码确认，行号级依据见 `docs/desktop-lyrics-analysis.md` §1。

- **Electron 单窗口现状**：主进程仅 `mainWindow` 一个 `BrowserWindow`；窗口类 IPC 硬编码 `mainWindow`；全仓库原本无第二窗口/子窗口抽象。
- **三 store 均为渲染进程单例**：`usePlayerStoreBase` / `useTimestampStoreBase` / `useSettingsStore`。Electron 每窗口 = 独立渲染进程 = 独立模块图，第二窗口 import 会得到全新实例（`initialState` 起步），无共享内存。
- **播放引擎在 renderer entry 无条件挂载**：`AppShell` 渲染 `PlayerProvider → AudioPlayers`，故桌面歌词必须独立 renderer entry，否则双引擎。
- **外部控制中继链**：`renderer-player-*` 通道 + `use-main-player-listener.tsx` 是现有「托盘/缩略图 → 主窗口播放」的唯一路径。
- **seek 唯一正确入口**：`mediaSeekToTimestamp(timestamp)`（经 `subscribePlayerSeekToTimestamp` 驱动各引擎）；`renderer-player-*` 无 seek 通道。
- **通用 preload `ipc` 无 `on`**：只暴露 `removeAllListeners/removeListener/send`；接收 main→renderer 需按 `mpvPlayerListener` 模式新增命名监听对象。

# 4. Adopted Architectural Decisions

**Decision:** Desktop Lyrics 与主窗口之间经 **main process 中转**（方案 A）。
**Reason:** 与 Feishin 现有 IPC 模式完全一致，侵入最小，生命周期可门控，权威态唯一。
**Source:** Phase 2 Architecture Design。

**Decision:** 权威态唯一 = 主窗口渲染进程的 `player/timestamp/settings` store；桌面歌词永远是 **read-only mirror + interaction request**。
**Reason:** 避免第二状态源、双引擎、状态双向竞争。
**Source:** Phase 2「Authoritative state 结论」；Phase 4 实现。

**Decision:** 歌词「获取/解析/定位」放在**主窗口 renderer**，复用现有 `lyricsQueries`/纯函数；桌面歌词侧只做「镜像 + 当前行定位 + 极简渲染」（Phase 5 方案 B）。
**Reason:** `SynchronizedLyrics` 组件链重度依赖主窗口 store（player/timestamp/settings + `mpvPlayer.seekTo` + 动画引擎 + Mantine），在独立进程无法直接复用。
**Source:** Phase 5「采用的复用方案」。

**Decision:** 锁状态单一权威 = 主进程 `desktopLyricsLocked`（拥有 `setIgnoreMouseEvents`）；renderer 的 `locked` 经 `desktop-lyrics-window-state` 回传镜像。
**Reason:** 支持外部解锁（主窗口 Settings「Unlock」），消除「锁定后窗口内无法解锁」问题。
**Source:** Phase 6B「锁状态同步」。

**Decision:** 设置归属 `lyrics.desktopLyrics`（`.optional()`，`{ alwaysOnTop, enabled, fontColor, fontSize }`），复用 `useSettingsStore`，零新增 store / 页面系统。
**Reason:** 向后兼容旧 `store_settings`（`.optional()`），随主设置持久化。
**Source:** Phase 6B「设置归属与形态」。

**Decision:** 开机自动开窗由 config bridge 挂载时主动 `sendConfig({enabled:true})` 实现。
**Reason:** 规避「主进程启动即需知开关」的镜像时机问题，不改 `main/index.ts` 启动流程。
**Source:** Phase 6B 偏差记录 #4。

# 5. Rejected / Superseded Designs

**Proposal:** renderer ↔ renderer 直接通信（`BroadcastChannel` / `localStorage` 事件 / `MessagePort`）。
**Reason rejected:** 依赖 `file://` 多窗口同源语义（【待确认】），引入仓库未用原语，主进程失去生命周期控制。
**Final decision:** 经 main process 中转（方案 A）。
**Source:** Phase 2 方案比较（方案 B）。

**Proposal:** Electron `MessageChannelMain` 直连两 renderer。
**Reason rejected:** port 建立/转移/关闭的心智成本高，与本仓库现状不一致，无收益。
**Final decision:** 经 main process 中转（方案 A）。
**Source:** Phase 2 方案比较（方案 C）。

**Proposal:** 直接复用 `SynchronizedLyrics` 组件。
**Reason rejected:** 需 seed/fake 3+ 主窗口 store + 拉入 DOM 动画引擎 + Mantine + 点击 seek 耦合。
**Final decision:** 复用纯逻辑 + 自建极简渲染层（方案 B）。
**Source:** Phase 5「采用的复用方案」。

**Proposal:** 引入通用 `WindowManager` 管理第二窗口。
**Reason rejected:** 本 PR 只有一个第二窗口，不满足抽象门槛。
**Final decision:** 单引用 `desktopLyricsWindow` + `isDestroyed()` 判空。
**Source:** Phase 2 §6。

**Proposal:** 桌面歌词 renderer 直接 `mpvPlayer.seekTo()` 实现 seek。
**Reason rejected:** 绕过 timestamp store、破坏 WEB/JUKEBOX/WAVESURFER 后端、引入第二状态源。
**Final decision:** seek 延后；将来唯一路径 = `desktop-lyrics-control{seek}` → main → `desktop-lyrics-seek` → 主窗口 `mediaSeekToTimestamp`。
**Source:** Phase 2 §3 / Phase 6A「seek 流程」。

# 6. Development Constraints

> 以下均来自历史/文档，非本文件自行发明。

- **最小侵入**：对现有代码侵入最小；不进行与 Desktop Lyrics 无关的重构。
  Source：Phase 2 方案选择理由 / 各 Phase「明确不修改」清单。
- **不建立第二套 player state / 第二状态源**：桌面歌词只读镜像，不持有播放队列、不驱动引擎。
  Source：Phase 2「Authoritative state」/ Phase 4/5 实现。
- **不重复轮询播放器**：复用现有 `subscribeCurrentTrack` / `subscribePlayerStatus` / `subscribePlayerProgress`，不自建 `setInterval`/轮询。
  Source：Phase 4「实际同步频率」。
- **播放控制复用 `renderer-player-*` 通道**：零新增主窗口播放监听（除将来 seek 的 `desktop-lyrics-seek`）。
  Source：Phase 6A「控制链」。
- **分阶段交付，每阶段明确边界**：每 Phase 标注「实现范围」与「明确不实现（延后）」，未实现项是延后而非遗漏。
  Source：docs 各 Phase 结构。
- **每阶段静态检查通过**：`pnpm run typecheck`、`lint-code`、`lint-styles`、`build:electron`。
  Source：docs 各 Phase「自动化验证」。

# 7. Development Workflow

历史实际采用过的流程（顺序）：

1. **源码考察**（只读，产出事实库）→ `docs/desktop-lyrics-analysis.md` §1–4。
2. **方案设计**（设计稿，不写代码）→ 同文件「Implementation Design」。
3. **分阶段实现**（Phase 3 → 6B），每阶段：明确范围 → 实现 → 静态检查 → 记录「与设计的偏差」与「待人工验证清单」。
4. **Runtime bug fix**（`pnpm dev` 下人工测试 → 定位 → 修复 → 静态复检）。

# 8. Current Desktop Lyrics Architecture

```
主窗口 renderer（唯一权威：player / timestamp / settings store）
   │  subscribeCurrentTrack / subscribePlayerStatus / subscribePlayerProgress
   │  歌词解析（lyricsQueries + 纯函数）→ DesktopLyricsData
   ▼
ipcRenderer.send('desktop-lyrics-state' / '-lyrics' / '-config')
   ▼
main process（src/main/features/core/desktop-lyrics/index.ts）
   │  ipcMain.on 中转（判空转发，不改造 payload）
   │  窗口生命周期 / 锁（setIgnoreMouseEvents）/ 置顶（setAlwaysOnTop）
   ▼
desktop-lyrics renderer（read-only mirror：独立 store，无 persist）
   └ 当前行定位 + 极简渲染 + 控制栏
```

- **playback state bridge**：`desktop-lyrics-state`（4Hz 快照：song/status/timestamp/playbackType/language）。
- **lyrics bridge**：`desktop-lyrics-lyrics`（低频，仅切歌/解析完成时推 `DesktopLyricsData`）。
- **config bridge**：`desktop-lyrics-config`（低频，`{ alwaysOnTop, enabled, fontColor, fontSize, lineLeadTimeMs }`）。
- **control channel**：`desktop-lyrics-control`（判别联合：close/lock/next/previous/set-locked-hover/toggle-play/unlock）。
- **authoritative state**：主窗口渲染进程（唯一权威）。
- **local mirror state**：桌面歌词渲染进程（`desktop-lyrics.store.ts` / `desktop-lyrics-lyrics.store.ts` / `desktop-lyrics-config.store.ts`，均无 persist）。

# 9. Current IPC Surface

以下为当前源码实际存在的 Desktop Lyrics 通道（`src/main/features/core/desktop-lyrics/index.ts` 注册）：

| Channel | 方向 | 类型 | 用途 |
| ------- | ---- | ---- | ---- |
| `desktop-lyrics-open` | 主窗口 renderer → main | invoke | 打开窗口 |
| `desktop-lyrics-close` | 主窗口 renderer → main | invoke | 关闭窗口（用户主动） |
| `desktop-lyrics-toggle` | 主窗口 renderer → main | invoke | 切换 |
| `desktop-lyrics-control` | 桌面歌词 renderer → main | send | 控制 intent（close/lock/next/previous/set-locked-hover/toggle-play/unlock） |
| `desktop-lyrics-config` | 主窗口 renderer → main → 桌面歌词 renderer | send | 配置快照（开窗 + 变更） |
| `desktop-lyrics-state` | 主窗口 renderer → main → 桌面歌词 renderer | send | 播放快照（4Hz） |
| `desktop-lyrics-lyrics` | 主窗口 renderer → main → 桌面歌词 renderer | send | 歌词数据（低频） |
| `desktop-lyrics-window-state` | main → 两个 renderer | send | 窗口状态 `{ open, locked }` |

- **不存在的通道**：`desktop-lyrics-seek`（seek 延后未实现）、`desktop-lyrics-lock`/`-unlock`（Phase 6A 已删除，并入 `desktop-lyrics-control`）。

# 10. Current Known Issues

**Fixed（已修复；其中 BUG-01/02/03 已在 6B 提交，BUG-05 与 Phase 6C-1 尚未提交）**

- **BUG-01/02/03（共同根因）**：`use-desktop-lyrics-config-bridge.ts` 的 window-state 监听器条件写反（`!state.open` 守卫使「窗口一打开就回写 enabled=false」）。
  - Root Cause: 条件反转（应为「仅在 open:false 且 enabled:true 时回写」）。
  - Fix: 单行条件反转 `if (state.open || !enabled) return;`（已确认在源码 `use-desktop-lyrics-config-bridge.ts:46`）。
  - 完整事件链：`enabled=false → true → did-finish-load open:true → 误回写 false → config false → 窗口立即销毁`。
- **BUG-02A（防御性修复，保留）**：`desktop-lyrics/index.ts` 的陈旧 `closed` 守卫 + 关闭原因显式化（`userInitiated`）。
  - Root Cause: 旧窗口延迟 `closed` 会清空新窗口引用、误发 `open:false`。
  - Fix: `if (desktopLyricsWindow !== window) return;` 守卫 + 仅用户主动关闭才 `notifyWindowState()`。无回归，保留。
- **BUG-05（Round 2）**：桌面歌词右侧垂直滚动条。Fix：`.desktop-lyrics-scroll` `scrollbar-width:none` + `::-webkit-scrollbar{display:none}`（保留滚动能力）。详见 analysis doc「Runtime Bug Fix Round 2」。

**已知限制（非 bug，延后）**

- 非同步歌词按「空状态」处理（无高亮纯文本渲染未实现）。
- 点击歌词 seek 未实现（`DesktopLyricsControlAction` 无 `seek`）。
- 透明度、背景色、字体族、对齐、动画速度、窗口位置记忆、主题、逐字 karaoke 未实现。

**平台风险（【待确认】，运行时行为）**

- Linux：`setIgnoreMouseEvents(true, {forward:true})` 的 `forward` 被忽略（锁定后 hover 不触发，预期）。
- Linux 部分合成器：`transparent:true` 可能不透明/异常。

# 11. Manual Verification Status

### Static verification（已通过，本机 Windows）

- `pnpm run typecheck`（node + web）✅
- `pnpm run lint-code`（eslint `--max-warnings=0`）✅
- `pnpm run lint-styles`（stylelint）✅
- `pnpm run build:electron` ✅

### Runtime verification

**Not yet manually verified**（各 Phase 均「未跑 dev 实例」）：

- Phase 4：11 个运行时场景（开窗快照/切歌/暂停/seek/快速开关无重复订阅/主窗口关闭停止同步等）。
- Phase 5：10 个歌词场景（高亮推进/平滑滚动/切歌清空/翻译 overlay/空状态/语言跟随等）。
- Phase 6A：10 个控制栏/hover/drag/锁定场景。
- Phase 6B：12 个设置入口/外部解锁/字号颜色/置顶/一致性场景 + 23 项 UI 点击测试。
- Phase 6C-1：锁定态 hover 解锁 / 窗口缩放与换行 / `lineLeadTimeMs` 提前滚动 / 控制栏在歌词上方 / 多显示器默认定位。
- 详细清单见 `docs/desktop-lyrics-analysis.md` 各 Phase「人工测试清单」。

> 绝不因代码逻辑看起来正确就写 PASS；以上均为待人工复核。

# 12. Next Action

- **Next action:** run manual runtime verification（`pnpm dev`），按 `docs/desktop-lyrics-analysis.md` 各 Phase 的人工测试清单逐项复核（尤其 Phase 6C-1 的五项 UX 场景、Phase 6B 的 23 项 UI 测试与 BUG-01/02/03/05 修复后行为）。
- **不应做**：继续开发未实现的高级项（6C-2 设置/入口、seek、透明度/背景色/主题、逐字 karaoke 等），除非用户明确进入下一阶段。

---

# Working With Existing Decisions

以下架构已被历史明确确定，**新的 session 不要因为没有原始聊天记录就重新设计**：

- IPC 架构（经 main 中转，方案 A）
- player architecture（主窗口唯一权威，桌面歌词只读镜像）
- lyrics architecture（主窗口解析 + 极简 payload + 独立镜像 store + 自建渲染）
- settings architecture（`lyrics.desktopLyrics` 子对象，复用 `useSettingsStore`）

涉及以上已定设计时，**先读取本文件与 `docs/desktop-lyrics-analysis.md`** 再决定。

如认为原设计存在问题，**不要直接重构**，必须先：

1. 指出冲突；
2. 找出原设计来源（本文件/analysis doc 中的对应条目）；
3. 说明为什么当前任务确实需要推翻；
4. 等用户确认后再进行架构改变。
