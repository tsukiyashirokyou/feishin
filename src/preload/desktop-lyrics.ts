import { ipcRenderer } from 'electron';

import {
    DesktopLyricsConfig,
    DesktopLyricsControlAction,
    DesktopLyricsData,
    DesktopLyricsSettingsChange,
    DesktopLyricsState,
    DesktopLyricsWindowState,
} from '/@/shared/types/desktop-lyrics';

const close = () => {
    return ipcRenderer.invoke('desktop-lyrics-close');
};

const control = (action: DesktopLyricsControlAction) => {
    ipcRenderer.send('desktop-lyrics-control', action);
};

const open = () => {
    return ipcRenderer.invoke('desktop-lyrics-open');
};

const sendConfig = (config: DesktopLyricsConfig) => {
    ipcRenderer.send('desktop-lyrics-config', config);
};

const sendLyrics = (lyrics: DesktopLyricsData) => {
    ipcRenderer.send('desktop-lyrics-lyrics', lyrics);
};

const sendState = (state: DesktopLyricsState) => {
    ipcRenderer.send('desktop-lyrics-state', state);
};

const toggle = () => {
    return ipcRenderer.invoke('desktop-lyrics-toggle');
};

const onConfig = (cb: (config: DesktopLyricsConfig) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, config: DesktopLyricsConfig) => cb(config);
    ipcRenderer.on('desktop-lyrics-config', listener);

    return () => ipcRenderer.removeListener('desktop-lyrics-config', listener);
};

const onLyrics = (cb: (lyrics: DesktopLyricsData) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, lyrics: DesktopLyricsData) => cb(lyrics);
    ipcRenderer.on('desktop-lyrics-lyrics', listener);

    return () => ipcRenderer.removeListener('desktop-lyrics-lyrics', listener);
};

const onState = (cb: (state: DesktopLyricsState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopLyricsState) => cb(state);
    ipcRenderer.on('desktop-lyrics-state', listener);

    return () => ipcRenderer.removeListener('desktop-lyrics-state', listener);
};

const onWindowState = (cb: (state: DesktopLyricsWindowState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopLyricsWindowState) =>
        cb(state);
    ipcRenderer.on('desktop-lyrics-window-state', listener);

    return () => ipcRenderer.removeListener('desktop-lyrics-window-state', listener);
};

const onSettingsChange = (cb: (change: DesktopLyricsSettingsChange) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, change: DesktopLyricsSettingsChange) =>
        cb(change);
    ipcRenderer.on('desktop-lyrics-settings-change', listener);

    return () => ipcRenderer.removeListener('desktop-lyrics-settings-change', listener);
};

export const desktopLyrics = {
    close,
    control,
    open,
    sendConfig,
    sendLyrics,
    sendState,
    toggle,
};

export const desktopLyricsListener = {
    onConfig,
    onLyrics,
    onSettingsChange,
    onState,
    onWindowState,
};

export type DesktopLyrics = typeof desktopLyrics;
export type DesktopLyricsListener = typeof desktopLyricsListener;
