import { is } from '@electron-toolkit/utils';
import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

import { getMainWindow } from '/@/main/index';
import log from '/@/main/logger';
import {
    DesktopLyricsControlAction,
    DesktopLyricsData,
    DesktopLyricsState,
} from '/@/shared/types/desktop-lyrics';

let desktopLyricsWindow: BrowserWindow | null = null;
let removeMainWindowClosedListener: (() => void) | null = null;

const isDesktopLyricsWindowUsable = () =>
    desktopLyricsWindow !== null && !desktopLyricsWindow.isDestroyed();

const closeDesktopLyricsWindow = () => {
    if (desktopLyricsWindow === null || desktopLyricsWindow.isDestroyed()) {
        desktopLyricsWindow = null;
        return;
    }

    desktopLyricsWindow.destroy();
};

const registerMainWindowClosedListener = () => {
    const mainWindow = getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const onMainWindowClosed = () => {
        closeDesktopLyricsWindow();
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

const setLocked = (locked: boolean) => {
    if (desktopLyricsWindow === null || desktopLyricsWindow.isDestroyed()) {
        return;
    }

    // `forward` keeps mouse-move events reaching the page (for hover states) while
    // clicks pass through. It is Windows/macOS only; Linux ignores it.
    desktopLyricsWindow.setIgnoreMouseEvents(locked, { forward: true });
};

const notifyMainWindowState = (open: boolean) => {
    const mainWindow = getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send('desktop-lyrics-window-state', { open });
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

    const window = new BrowserWindow({
        alwaysOnTop: true,
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

    // Gate the initial playback-state snapshot on `did-finish-load` rather than
    // `ready-to-show`: by the time the page has fully loaded, the renderer's
    // module script has executed and its state listener is registered, so the
    // main window can safely push the current state without a race.
    window.webContents.on('did-finish-load', () => {
        notifyMainWindowState(true);
    });

    window.on('closed', () => {
        log.info('Desktop lyrics window closed');
        unregisterMainWindowClosedListener();
        notifyMainWindowState(false);
        desktopLyricsWindow = null;
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
    closeDesktopLyricsWindow();
});

ipcMain.handle('desktop-lyrics-toggle', () => {
    if (isDesktopLyricsWindowUsable()) {
        closeDesktopLyricsWindow();
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
            closeDesktopLyricsWindow();
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
