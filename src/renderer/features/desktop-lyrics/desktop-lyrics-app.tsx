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
    const lineLeadTimeMs = useDesktopLyricsConfigStore((state) => state.lineLeadTimeMs);
    const [locked, setLocked] = useState(false);
    const lockedHoverRef = useRef(false);

    // The main process is authoritative for the lock state (it owns
    // `setIgnoreMouseEvents`). This renderer's `locked` is a UI mirror fed by the
    // window-state echo, so an external unlock (from the main window settings)
    // correctly reveals the control bar again. Any authoritative lock-state change
    // also drops the transient hover reveal.
    useEffect(() => {
        const removeWindowStateListener = window.api.desktopLyricsListener.onWindowState(
            (state) => {
                setLocked(state.locked);
                lockedHoverRef.current = false;
            },
        );

        return () => {
            removeWindowStateListener();
        };
    }, []);

    const handleLock = useCallback(() => {
        lockedHoverRef.current = false;
        setLocked(true);
        window.api.desktopLyrics.control({ type: 'lock' });
    }, []);

    const handleUnlock = useCallback(() => {
        lockedHoverRef.current = false;
        setLocked(false);
        window.api.desktopLyrics.control({ type: 'unlock' });
    }, []);

    // A locked window is mouse-through (`setIgnoreMouseEvents(true, { forward:
    // true })`), so no DOM element — including an unlock button — can receive a
    // click. `forward` still delivers mouse-move events, so hovering a locked
    // window signals the main process to temporarily restore interactivity
    // (`set-locked-hover: true`) until the cursor leaves; leaving re-applies
    // mouse-through. This never changes the authoritative lock state.
    const handleMouseMove = useCallback(() => {
        if (!locked || lockedHoverRef.current) {
            return;
        }

        lockedHoverRef.current = true;
        window.api.desktopLyrics.control({ hovered: true, type: 'set-locked-hover' });
    }, [locked]);

    const handleMouseLeave = useCallback(() => {
        if (!lockedHoverRef.current) {
            return;
        }

        lockedHoverRef.current = false;
        window.api.desktopLyrics.control({ hovered: false, type: 'set-locked-hover' });
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

    // `activeIndex` is the highlighted line, strictly keyed to the lyrics timeline
    // (no lead time). `scrollIndex` is the scroll target, chosen ahead of the
    // highlight by `lineLeadTimeMs` so the next line moves toward the center
    // before it is sung — mirroring the fullscreen lyrics scroll-ahead without
    // advancing the highlight.
    const activeIndex = useMemo(() => {
        if (!normalizedLyrics) {
            return -1;
        }

        return getCurrentLyricIndex(normalizedLyrics, timestamp * 1000 + lyricsData.offsetMs);
    }, [lyricsData.offsetMs, normalizedLyrics, timestamp]);

    const scrollIndex = useMemo(() => {
        if (!normalizedLyrics) {
            return -1;
        }

        return getCurrentLyricIndex(
            normalizedLyrics,
            timestamp * 1000 + lyricsData.offsetMs + lineLeadTimeMs,
        );
    }, [lineLeadTimeMs, lyricsData.offsetMs, normalizedLyrics, timestamp]);

    const scrollLineRef = useRef<HTMLDivElement | null>(null);

    // Center the scroll target as it advances. Only fires when the target line
    // changes (not on every timestamp tick), so the smooth scroll isn't constantly
    // restarted.
    useEffect(() => {
        scrollLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [scrollIndex]);

    return (
        <div
            className="desktop-lyrics-root"
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
            style={rootStyle}
        >
            <DesktopLyricsControlBar locked={locked} onLock={handleLock} onUnlock={handleUnlock} />
            {normalizedLyrics?.length ? (
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
                                ref={index === scrollIndex ? scrollLineRef : undefined}
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
            ) : (
                <div className="desktop-lyrics-empty">{t('page.fullscreenPlayer.noLyrics')}</div>
            )}
        </div>
    );
};
