import { is } from '@electron-toolkit/utils';
import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

import { getMainWindow } from '/@/main/index';
import log from '/@/main/logger';
import {
    DesktopLyricsConfig,
    DesktopLyricsControlAction,
    DesktopLyricsData,
    DesktopLyricsState,
    DesktopLyricsWindowState,
} from '/@/shared/types/desktop-lyrics';

const DEFAULT_DESKTOP_LYRICS_CONFIG: DesktopLyricsConfig = {
    alwaysOnTop: true,
    enabled: false,
    fontColor: '#ffffff',
    fontSize: 22,
};

let currentDesktopLyricsConfig: DesktopLyricsConfig = DEFAULT_DESKTOP_LYRICS_CONFIG;
let desktopLyricsLocked = false;
let desktopLyricsCloseWasUserInitiated = false;
let desktopLyricsWindow: BrowserWindow | null = null;
let removeMainWindowClosedListener: (() => void) | null = null;

const isDesktopLyricsWindowUsable = () =>
    desktopLyricsWindow !== null && !desktopLyricsWindow.isDestroyed();

// `userInitiated` distinguishes a user request (the desktop lyrics close button
// or an explicit main-window close) from internal lifecycle closes (settings
// disabled, main window closed on quit). Only user-initiated closes must signal
// the renderer to turn the `enabled` setting off.
const closeDesktopLyricsWindow = (userInitiated = false) => {
    if (desktopLyricsWindow === null || desktopLyricsWindow.isDestroyed()) {
        desktopLyricsWindow = null;
        return;
    }

    desktopLyricsCloseWasUserInitiated = userInitiated;
    desktopLyricsWindow.destroy();
};

const registerMainWindowClosedListener = () => {
    const mainWindow = getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const onMainWindowClosed = () => {
        closeDesktopLyricsWindow(false);
    };

    mainWindow.on('closed', onMainWindowClosed);
    removeMainWindowClosedListener = () => {
        mainWindow.removeListener('closed', onMainWindowClosed);
    };
};

const unregisterMainWindowClosedListener = () => {
    removeMainWindowClosedListener?.();
    removeMainWindowClosedListener = null;
};

const getWindowState = (): DesktopLyricsWindowState => ({
    locked: desktopLyricsLocked,
    open: isDesktopLyricsWindowUsable(),
});

// Push the desktop lyrics window state (`open` + `locked`) to both the main
// window renderer (mirrors `open` to drive sync and settings consistency) and the
// desktop lyrics renderer (mirrors `locked` to show/hide the control bar). The
// main process owns both flags; the renderers only mirror them.
const notifyWindowState = () => {
    const state = getWindowState();

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop-lyrics-window-state', state);
    }

    if (desktopLyricsWindow !== null && !desktopLyricsWindow.isDestroyed()) {
        desktopLyricsWindow.webContents.send('desktop-lyrics-window-state', state);
    }
};

const sendConfigToDesktopLyrics = () => {
    if (desktopLyricsWindow === null || desktopLyricsWindow.isDestroyed()) {
        return;
    }

    desktopLyricsWindow.webContents.send('desktop-lyrics-config', currentDesktopLyricsConfig);
};

const setLocked = (locked: boolean) => {
    desktopLyricsLocked = locked;

    if (desktopLyricsWindow === null || desktopLyricsWindow.isDestroyed()) {
        return;
    }

    // `forward` keeps mouse-move events reaching the page (for hover states) while
    // clicks pass through. It is Windows/macOS only; Linux ignores it.
    desktopLyricsWindow.setIgnoreMouseEvents(locked, { forward: true });
    notifyWindowState();
};

const sendToMainWindow = (channel: string) => {
    const mainWindow = getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send(channel);
};

const createDesktopLyricsWindow = () => {
    if (isDesktopLyricsWindowUsable()) {
        return;
    }

    // A fresh window always starts unlocked and with no pending close reason; the
    // authoritative flags are reset here (in addition to on close) so a stale flag
    // can never desync the renderer or leak a previous window's close reason into
    // this one.
    desktopLyricsLocked = false;
    desktopLyricsCloseWasUserInitiated = false;

    const window = new BrowserWindow({
        alwaysOnTop: currentDesktopLyricsConfig.alwaysOnTop,
        frame: false,
        hasShadow: false,
        height: 160,
        resizable: false,
        show: false,
        skipTaskbar: true,
        transparent: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(__dirname, '../preload/index.js'),
            sandbox: true,
        },
        width: 600,
    });

    desktopLyricsWindow = window;

    window.on('ready-to-show', () => {
        window.show();
    });

    // Gate the initial config + window-state push on `did-finish-load` rather than
    // `ready-to-show`: by the time the page has fully loaded, the renderer's
    // module script has executed and its listeners are registered, so the main
    // window can safely push the current config and state without a race.
    window.webContents.on('did-finish-load', () => {
        sendConfigToDesktopLyrics();
        notifyWindowState();
    });

    window.on('closed', () => {
        // Ignore a stale 'closed' from a window that has already been replaced by a
        // newer one. This happens when a close is immediately followed by a new
        // open: the old window's 'closed' fires after `desktopLyricsWindow` has
        // been reassigned, and must not clobber the new reference or emit a
        // spurious `open: false`.
        if (desktopLyricsWindow !== window) {
            return;
        }

        log.info('Desktop lyrics window closed');

        const wasUserInitiated = desktopLyricsCloseWasUserInitiated;
        desktopLyricsCloseWasUserInitiated = false;

        unregisterMainWindowClosedListener();
        desktopLyricsWindow = null;
        desktopLyricsLocked = false;

        // Only a user-initiated close should tell the main window renderer to turn
        // the `enabled` setting off. Internal lifecycle closes (settings disabled,
        // app quit) must leave the setting untouched.
        if (wasUserInitiated) {
            notifyWindowState();
        }
    });

    registerMainWindowClosedListener();

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/desktop-lyrics.html`);
    } else {
        window.loadFile(join(__dirname, '../renderer/desktop-lyrics.html'));
    }

    log.info('Desktop lyrics window created');
};

ipcMain.handle('desktop-lyrics-open', () => {
    createDesktopLyricsWindow();
});

ipcMain.handle('desktop-lyrics-close', () => {
    closeDesktopLyricsWindow(true);
});

ipcMain.handle('desktop-lyrics-toggle', () => {
    if (isDesktopLyricsWindowUsable()) {
        closeDesktopLyricsWindow(true);
    } else {
        createDesktopLyricsWindow();
    }
});

// Handle a control intent from the desktop lyrics renderer's control bar.
// Player controls are relayed to the main window's existing `renderer-player-*`
// channels (the main window is the only authoritative player); window actions
// (lock/unlock/close) are handled locally. No seek action: click-to-seek is
// deferred and, when added, must go through the main window's
// `mediaSeekToTimestamp` rather than a direct `mpvPlayer.seekTo`.
ipcMain.on('desktop-lyrics-control', (_event, action: DesktopLyricsControlAction) => {
    switch (action.type) {
        case 'close':
            closeDesktopLyricsWindow(true);
            break;
        case 'lock':
            setLocked(true);
            break;
        case 'next':
            sendToMainWindow('renderer-player-next');
            break;
        case 'previous':
            sendToMainWindow('renderer-player-previous');
            break;
        case 'toggle-play':
            sendToMainWindow('renderer-player-play-pause');
            break;
        case 'unlock':
            setLocked(false);
            break;
    }
});

// Receive the desktop lyrics configuration from the main window renderer (the
// settings authority). Stores it for window creation, applies `alwaysOnTop`
// immediately, relays the config to the desktop lyrics renderer, and reconciles
// the window open/close state with `enabled`. The reconciliation is declarative
// and idempotent, so a font/color change never re-opens an already-open window.
ipcMain.on('desktop-lyrics-config', (_event, config: DesktopLyricsConfig) => {
    currentDesktopLyricsConfig = config;

    if (isDesktopLyricsWindowUsable()) {
        desktopLyricsWindow!.setAlwaysOnTop(config.alwaysOnTop);
    }

    sendConfigToDesktopLyrics();

    if (config.enabled && !isDesktopLyricsWindowUsable()) {
        createDesktopLyricsWindow();
    } else if (!config.enabled && isDesktopLyricsWindowUsable()) {
        // `enabled` was just turned off in the settings, so the setting is already
        // consistent — this is an internal close, not a user-initiated one.
        closeDesktopLyricsWindow(false);
    }
});

// Forward a playback-state snapshot from the main window renderer to the
// desktop lyrics renderer. The main window is the single source of truth; this
// module only relays the payload and never inspects it.
ipcMain.on('desktop-lyrics-state', (_event, state: DesktopLyricsState) => {
    if (desktopLyricsWindow === null || desktopLyricsWindow.isDestroyed()) {
        return;
    }

    desktopLyricsWindow.webContents.send('desktop-lyrics-state', state);
});

// Forward the resolved synchronized lyrics for the current song. Pushed by the
// main window renderer whenever the lyrics change (song change / fetch result),
// independently of the high-frequency playback-state snapshot above.
ipcMain.on('desktop-lyrics-lyrics', (_event, lyrics: DesktopLyricsData) => {
    if (desktopLyricsWindow === null || desktopLyricsWindow.isDestroyed()) {
        return;
    }

    desktopLyricsWindow.webContents.send('desktop-lyrics-lyrics', lyrics);
});
