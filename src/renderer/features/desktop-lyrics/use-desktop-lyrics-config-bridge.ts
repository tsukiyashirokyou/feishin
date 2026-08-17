import isElectron from 'is-electron';
import { useEffect } from 'react';

import {
    useDesktopLyricsSettings,
    useSettingsStore,
    useSettingsStoreActions,
} from '/@/renderer/store';
import {
    DesktopLyricsConfig,
    DesktopLyricsSettingsChange,
    DesktopLyricsWindowState,
} from '/@/shared/types/desktop-lyrics';

// Bridges desktop lyrics settings from the main window renderer (the settings
// authority) to the main process. Low-frequency: only the relevant fields are
// sent, on mount (so `enabled` can auto-open on startup) and whenever any of
// them change. The main process reconciles open/close from `enabled` and applies
// `alwaysOnTop`; the desktop lyrics renderer applies `fontSize`/`fontColor`/
// `layout` and uses the desktop-lyrics-specific `lineLeadTimeMs` for its
// scroll-ahead.
export const useDesktopLyricsConfigBridge = () => {
    const { alwaysOnTop, enabled, fontColor, fontSize, layout, lineLeadTimeMs } =
        useDesktopLyricsSettings();
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
            layout,
            lineLeadTimeMs,
        };

        window.api.desktopLyrics.sendConfig(config);
    }, [alwaysOnTop, enabled, fontColor, fontSize, layout, lineLeadTimeMs]);

    // Apply in-window settings changes from the desktop lyrics renderer back to
    // the authoritative settings store. The desktop lyrics renderer is a
    // read-only mirror, so its settings popover sends `set-config` intents, which
    // the main process relays here; writing the store triggers the config bridge
    // effect above to push the updated config back to the desktop lyrics renderer,
    // closing the loop. The current settings are read synchronously so only the
    // changed field is replaced (no stale closure over other fields).
    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        const onSettingsChange = (change: DesktopLyricsSettingsChange) => {
            const current = useSettingsStore.getState().lyrics.desktopLyrics;
            const base = {
                alwaysOnTop: current?.alwaysOnTop ?? true,
                enabled: current?.enabled ?? false,
                fontColor: current?.fontColor ?? '#ffffff',
                fontSize: current?.fontSize ?? 22,
                layout: current?.layout ?? 'vertical',
                lineLeadTimeMs: current?.lineLeadTimeMs ?? 800,
            };

            if (change.field === 'fontSize') {
                setSettings({
                    lyrics: { desktopLyrics: { ...base, fontSize: Number(change.value) } },
                });
                return;
            }

            if (change.field === 'fontColor') {
                setSettings({
                    lyrics: { desktopLyrics: { ...base, fontColor: String(change.value) } },
                });
                return;
            }

            setSettings({
                lyrics: {
                    desktopLyrics: {
                        ...base,
                        layout: change.value === 'horizontal' ? 'horizontal' : 'vertical',
                    },
                },
            });
        };

        const removeSettingsChangeListener =
            window.api.desktopLyricsListener.onSettingsChange(onSettingsChange);

        return () => {
            removeSettingsChangeListener();
        };
    }, [setSettings]);

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
                        layout,
                        lineLeadTimeMs,
                    },
                },
            });
        };

        const removeWindowStateListener =
            window.api.desktopLyricsListener.onWindowState(onWindowState);

        return () => {
            removeWindowStateListener();
        };
    }, [alwaysOnTop, enabled, fontColor, fontSize, layout, lineLeadTimeMs, setSettings]);
};
