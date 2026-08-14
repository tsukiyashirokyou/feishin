import { create } from 'zustand';

import { DesktopLyricsConfig } from '/@/shared/types/desktop-lyrics';

// Read-only mirror of the desktop lyrics configuration pushed by the main window
// renderer (the settings authority) via the main process. Never persisted; only
// `fontSize` and `fontColor` drive this renderer's display (`enabled`/`alwaysOnTop`
// are window-level concerns handled by the main process).
export const useDesktopLyricsConfigStore = create<DesktopLyricsConfig>(() => ({
    alwaysOnTop: true,
    enabled: false,
    fontColor: '#ffffff',
    fontSize: 22,
}));

// Registered at module load so the listener is guaranteed to be present before
// the main process emits the initial config on `did-finish-load`.
window.api.desktopLyricsListener.onConfig((config) => {
    useDesktopLyricsConfigStore.setState(config);
});
