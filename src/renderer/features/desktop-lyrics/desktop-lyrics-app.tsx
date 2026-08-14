import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDesktopLyricsConfigStore } from './desktop-lyrics-config.store';
import { DesktopLyricsControlBar } from './desktop-lyrics-control-bar';
import { useDesktopLyricsLyricsStore } from './desktop-lyrics-lyrics.store';
import { useDesktopLyricsStore } from './desktop-lyrics.store';

import i18n from '/@/i18n/i18n';
import {
    findOverlayLineByTime,
    getCurrentLyricIndex,
    getLyricLineStartMs,
    getLyricLineText,
    normalizeLyrics,
} from '/@/renderer/features/lyrics/api/lyrics-utils';
import './desktop-lyrics.css';

export const DesktopLyricsApp = () => {
    const { t } = useTranslation();
    const language = useDesktopLyricsStore((state) => state.language);
    const timestamp = useDesktopLyricsStore((state) => state.timestamp);
    const lyricsData = useDesktopLyricsLyricsStore();
    const fontColor = useDesktopLyricsConfigStore((state) => state.fontColor);
    const fontSize = useDesktopLyricsConfigStore((state) => state.fontSize);
    const [locked, setLocked] = useState(false);

    // The main process is authoritative for the lock state (it owns
    // `setIgnoreMouseEvents`). This renderer's `locked` is a UI mirror fed by the
    // window-state echo, so an external unlock (from the main window settings)
    // correctly reveals the control bar again.
    useEffect(() => {
        const removeWindowStateListener = window.api.desktopLyricsListener.onWindowState(
            (state) => {
                setLocked(state.locked);
            },
        );

        return () => {
            removeWindowStateListener();
        };
    }, []);

    // Locking is one-way from within this window: once locked the window is
    // click-through, so the control bar is hidden and there is no in-window
    // unlock. The optimistic set hides the bar immediately; the echo above
    // confirms the authoritative state.
    const handleLock = useCallback(() => {
        setLocked(true);
        window.api.desktopLyrics.control({ type: 'lock' });
    }, []);

    const rootStyle = {
        '--desktop-lyrics-font-color': fontColor,
        '--desktop-lyrics-font-size': `${fontSize}px`,
    } as CSSProperties;

    // The desktop lyrics renderer is its own process, so the i18n singleton
    // defaults to the fallback language until it learns the main window's
    // current language from the playback-state snapshot.
    useEffect(() => {
        if (language) {
            i18n.changeLanguage(language);
        }
    }, [language]);

    const normalizedLyrics = useMemo(
        () => (lyricsData.lyrics ? normalizeLyrics(lyricsData.lyrics) : null),
        [lyricsData.lyrics],
    );

    const activeIndex = useMemo(() => {
        if (!normalizedLyrics) {
            return -1;
        }

        return getCurrentLyricIndex(normalizedLyrics, timestamp * 1000 + lyricsData.offsetMs);
    }, [lyricsData.offsetMs, normalizedLyrics, timestamp]);

    const activeLineRef = useRef<HTMLDivElement | null>(null);

    // Center the active line as it advances. Only fires when the active line
    // changes (not on every timestamp tick), so the smooth scroll isn't
    // constantly restarted.
    useEffect(() => {
        activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [activeIndex]);

    if (!normalizedLyrics?.length) {
        return (
            <div className="desktop-lyrics-root" style={rootStyle}>
                <div className="desktop-lyrics-empty">{t('page.fullscreenPlayer.noLyrics')}</div>
                {!locked && <DesktopLyricsControlBar onLock={handleLock} />}
            </div>
        );
    }

    return (
        <div className="desktop-lyrics-root" style={rootStyle}>
            <div className="desktop-lyrics-scroll">
                {normalizedLyrics.map((line, index) => {
                    const startMs = getLyricLineStartMs(line);
                    const text = getLyricLineText(line);
                    const isActive = index === activeIndex;
                    const translationText = lyricsData.translationLyrics
                        ? findOverlayLineByTime(lyricsData.translationLyrics, startMs, index)
                        : undefined;
                    const pronunciationText = lyricsData.pronunciationLyrics
                        ? findOverlayLineByTime(lyricsData.pronunciationLyrics, startMs, index)
                        : undefined;

                    return (
                        <div
                            className={`desktop-lyrics-line${
                                isActive ? ' desktop-lyrics-line-active' : ''
                            }`}
                            key={index}
                            ref={isActive ? activeLineRef : undefined}
                        >
                            <div className="desktop-lyrics-line-main">
                                {text.replaceAll('_BREAK_', '\n')}
                            </div>
                            {pronunciationText && (
                                <div className="desktop-lyrics-line-pronunciation">
                                    {pronunciationText}
                                </div>
                            )}
                            {translationText && (
                                <div className="desktop-lyrics-line-translation">
                                    {translationText}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {!locked && <DesktopLyricsControlBar onLock={handleLock} />}
        </div>
    );
};
