import isElectron from 'is-electron';
import { useEffect } from 'react';

import {
    subscribeCurrentTrack,
    subscribePlayerStatus,
    usePlayerStoreBase,
    useSettingsStore,
} from '/@/renderer/store';
import { subscribePlayerProgress, useTimestampStoreBase } from '/@/renderer/store/timestamp.store';
import {
    DesktopLyricsSong,
    DesktopLyricsState,
    DesktopLyricsWindowState,
} from '/@/shared/types/desktop-lyrics';
import { QueueSong } from '/@/shared/types/domain-types';

const toDesktopLyricsSong = (song: QueueSong): DesktopLyricsSong => ({
    album: song.album,
    artistName: song.artistName,
    duration: song.duration,
    imageUrl: song.imageUrl,
    name: song.name,
});

// Bridges playback state from the main window renderer (the single source of
// truth) to the desktop lyrics renderer. Mounted in `AppEffects` so it lives for
// the lifetime of the main window and survives the desktop lyrics window being
// opened/closed repeatedly without leaking subscriptions.
export const useDesktopLyricsBridge = () => {
    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        const unsubscribers: (() => void)[] = [];

        const pushState = () => {
            const playerState = usePlayerStoreBase.getState();
            const song = playerState.getCurrentSong();

            const state: DesktopLyricsState = {
                language: useSettingsStore.getState().general.language,
                playbackType: useSettingsStore.getState().playback.type,
                song: song ? toDesktopLyricsSong(song) : undefined,
                status: playerState.player.status,
                timestamp: useTimestampStoreBase.getState().timestamp,
            };

            window.api.desktopLyrics.sendState(state);
        };

        const stopSync = () => {
            while (unsubscribers.length > 0) {
                unsubscribers.pop()?.();
            }
        };

        const startSync = () => {
            // Defensive: rapid open/close/open cycles must never stack subscriptions.
            stopSync();

            unsubscribers.push(
                subscribeCurrentTrack(() => pushState()),
                subscribePlayerStatus(() => pushState()),
                subscribePlayerProgress(() => pushState()),
            );

            // Push a full snapshot immediately so the freshly opened window shows the
            // current song/status/timestamp/playback type without waiting for a change.
            pushState();
        };

        const onWindowState = (state: DesktopLyricsWindowState) => {
            if (state.open) {
                startSync();
            } else {
                stopSync();
            }
        };

        const removeWindowStateListener =
            window.api.desktopLyricsListener.onWindowState(onWindowState);

        return () => {
            removeWindowStateListener();
            stopSync();
        };
    }, []);
};
