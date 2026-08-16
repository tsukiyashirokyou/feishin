import isElectron from 'is-electron';
import { useEffect } from 'react';

import {
    useDesktopLyricsSettings,
    useLyricsSettings,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { DesktopLyricsConfig, DesktopLyricsWindowState } from '/@/shared/types/desktop-lyrics';

// Bridges desktop lyrics settings from the main window renderer (the settings
// authority) to the main process. Low-frequency: only the relevant fields are
// sent, on mount (so `enabled` can auto-open on startup) and whenever any of
// them change. The main process reconciles open/close from `enabled` and applies
// `alwaysOnTop`; the desktop lyrics renderer applies `fontSize`/`fontColor` and
// uses `lineLeadTimeMs` (from the shared lyrics settings) for its scroll-ahead.
export const useDesktopLyricsConfigBridge = () => {
    const { alwaysOnTop, enabled, fontColor, fontSize } = useDesktopLyricsSettings();
    const { lineLeadTimeMs } = useLyricsSettings();
    const { setSettings } = useSettingsStoreActions();

    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        const config: DesktopLyricsConfig = {
            alwaysOnTop,
            enabled,
            fontColor,
            fontSize,
            lineLeadTimeMs,
        };

        window.api.desktopLyrics.sendConfig(config);
    }, [alwaysOnTop, enabled, fontColor, fontSize, lineLeadTimeMs]);

    // Keep `enabled` consistent with the actual window state: when the desktop
    // lyrics window closes on its own (via its close button), turn the setting
    // off so the settings UI never shows "enabled" while the window is gone.
    // Closing the app does not reach here — the main process clears the main
    // window reference before emitting `closed`, so this listener only fires
    // while the main window is still alive.
    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        const onWindowState = (state: DesktopLyricsWindowState) => {
            // Only react to a close (`open: false`) while the setting is still on.
            // The window must be gone before we turn `enabled` off, otherwise an
            // `open: true` (which fires on every load) would immediately clear it.
            if (state.open || !enabled) {
                return;
            }

            setSettings({
                lyrics: {
                    desktopLyrics: {
                        alwaysOnTop,
                        enabled: false,
                        fontColor,
                        fontSize,
                    },
                },
            });
        };

        const removeWindowStateListener =
            window.api.desktopLyricsListener.onWindowState(onWindowState);

        return () => {
            removeWindowStateListener();
        };
    }, [alwaysOnTop, enabled, fontColor, fontSize, setSettings]);
};
