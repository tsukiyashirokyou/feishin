import { useQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { useEffect, useRef, useState } from 'react';

import {
    computeSelectedFromResult,
    getDisplayOffset,
    lyricsQueries,
} from '/@/renderer/features/lyrics/api/lyrics-api';
import { getLyricsLayers } from '/@/renderer/features/lyrics/api/lyrics-utils';
import { useIsRadioActive } from '/@/renderer/features/radio/hooks/use-radio-player';
import { useLyricsSettings, usePlayerSong } from '/@/renderer/store';
import { DesktopLyricsData } from '/@/shared/types/desktop-lyrics';

const EMPTY_LYRICS: DesktopLyricsData = {
    lyrics: undefined,
    offsetMs: 0,
    pronunciationLyrics: undefined,
    translationLyrics: undefined,
};

const sendLyrics = (lyrics: DesktopLyricsData) => {
    if (isElectron()) {
        window.api.desktopLyrics.sendLyrics(lyrics);
    }
};

// Resolves the synchronized lyrics for the current song in the main window
// renderer — the only process with the server list, settings and query client
// needed to fetch them — and forwards the result to the desktop lyrics window.
// Mounted for the lifetime of the main window (like the playback-state bridge),
// so lyrics stay in sync with the current song regardless of whether the
// desktop lyrics window is open.
export const useDesktopLyricsLyricsBridge = () => {
    const currentSong = usePlayerSong();
    const isRadioActive = useIsRadioActive();
    const { preferLocalLyrics } = useLyricsSettings();

    const [pendingSongId, setPendingSongId] = useState<string | undefined>(undefined);
    const previousSongIdRef = useRef<string | undefined>(undefined);
    const lyricsFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastLyricsRef = useRef<DesktopLyricsData>(EMPTY_LYRICS);

    // Debounce track changes so rapid skipping doesn't fetch lyrics for every
    // intermediate song (mirrors the fullscreen lyrics component). Clear
    // immediately so the previous song's lyrics never linger while fetching.
    useEffect(() => {
        const currentSongId = currentSong?.id;
        const previousSongId = previousSongIdRef.current;

        if (currentSongId === previousSongId) {
            return;
        }

        previousSongIdRef.current = currentSongId;
        setPendingSongId(undefined);
        sendLyrics(EMPTY_LYRICS);

        clearTimeout(lyricsFetchTimeoutRef.current);

        if (!currentSongId || isRadioActive) {
            return;
        }

        lyricsFetchTimeoutRef.current = setTimeout(() => {
            setPendingSongId(currentSongId);
        }, 500);

        return () => {
            clearTimeout(lyricsFetchTimeoutRef.current);
        };
    }, [currentSong?.id, isRadioActive]);

    // Radio streams have no lyrics; clear immediately if radio becomes active.
    useEffect(() => {
        if (isRadioActive) {
            setPendingSongId(undefined);
            sendLyrics(EMPTY_LYRICS);
        }
    }, [isRadioActive]);

    const shouldFetchLyrics = !!currentSong?._serverId && !!currentSong?.id && !isRadioActive;
    const isWaitingToFetchLyrics = shouldFetchLyrics && pendingSongId !== currentSong?.id;

    const { data } = useQuery(
        lyricsQueries.songLyrics(
            {
                options: {
                    enabled: !!pendingSongId && pendingSongId === currentSong?.id && !isRadioActive,
                },
                query: { songId: currentSong?.id || '' },
                serverId: currentSong?._serverId || '',
            },
            currentSong,
        ),
    );

    useEffect(() => {
        if (isWaitingToFetchLyrics || !data) {
            return;
        }

        const { selected, selectedSynced } = computeSelectedFromResult(
            data,
            preferLocalLyrics,
            data.selectedStructuredIndex,
        );

        const offsetMs = getDisplayOffset(
            selected,
            data.selectedOffsetMs,
            data.selectedStructuredIndex,
            data.local,
        );

        const layers = Array.isArray(data.local) ? getLyricsLayers(data.local) : null;
        const pronunciationLyric = layers?.pronunciation;
        const translationLyric = layers?.translation;

        const lyrics =
            selected && selectedSynced && Array.isArray(selected.lyrics)
                ? selected.lyrics
                : undefined;

        const lyricsData: DesktopLyricsData = {
            lyrics,
            offsetMs: lyrics ? offsetMs : 0,
            pronunciationLyrics: pronunciationLyric?.synced ? pronunciationLyric.lyrics : undefined,
            translationLyrics: translationLyric?.synced ? translationLyric.lyrics : undefined,
        };

        lastLyricsRef.current = lyricsData;
        sendLyrics(lyricsData);
    }, [data, isWaitingToFetchLyrics, preferLocalLyrics]);

    // Re-push the current song's lyrics when the desktop lyrics window opens so a
    // freshly-opened window shows lyrics immediately. The lyrics are otherwise only
    // pushed on song change, and the main process drops pushes made while the
    // window is closed.
    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        const removeWindowStateListener = window.api.desktopLyricsListener.onWindowState(
            (state) => {
                if (state.open) {
                    sendLyrics(lastLyricsRef.current);
                }
            },
        );

        return () => {
            removeWindowStateListener();
        };
    }, []);
};
