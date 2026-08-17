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

// Where the scroll target line sits within the viewport: 0.5 centers it, matching
// the fullscreen lyrics' centered scroll while staying height-aware.
const SCROLL_ANCHOR_FRACTION = 0.5;

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
    const [isResizing, setIsResizing] = useState(false);

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

    // Track an active window resize so the scroll anchor can be re-applied once it
    // ends (the browser holds `scrollTop` across a resize, so the anchor drifts).
    // The renderer only observes viewport size changes (Electron's `resized` event
    // is main-process only), so a debounce approximates "resize ended"; the
    // initial size is captured on mount so the state never flips on load. This
    // state no longer drives the window boundary — that is now hover-driven CSS.
    useEffect(() => {
        let lastSize = { height: window.innerHeight, width: window.innerWidth };
        let timeout: ReturnType<typeof setTimeout> | undefined;

        const handleResize = () => {
            const { innerHeight, innerWidth } = window;

            if (innerHeight === lastSize.height && innerWidth === lastSize.width) {
                return;
            }

            lastSize = { height: innerHeight, width: innerWidth };
            setIsResizing(true);
            clearTimeout(timeout);
            timeout = setTimeout(() => setIsResizing(false), 250);
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(timeout);
        };
    }, []);

    const normalizedLyrics = useMemo(
        () => (lyricsData.lyrics ? normalizeLyrics(lyricsData.lyrics) : null),
        [lyricsData.lyrics],
    );

    // `activeIndex` is the highlighted line, strictly keyed to the lyrics timeline
    // (no lead time) — never advanced or compensated. `scrollIndex` is the scroll
    // target, chosen ahead of the highlight by `lineLeadTimeMs` so the next line
    // moves toward the center before it is sung — mirroring the fullscreen lyrics
    // scroll-ahead without advancing the highlight.
    const activeIndex = useMemo(() => {
        if (!normalizedLyrics) {
            return -1;
        }

        return getCurrentLyricIndex(normalizedLyrics, timestamp * 1000 + lyricsData.offsetMs);
    }, [lyricsData.offsetMs, normalizedLyrics, timestamp]);

    const scrollIndex = useMemo(() => {
        if (!normalizedLyrics || activeIndex < 0) {
            return -1;
        }

        const aheadIndex = getCurrentLyricIndex(
            normalizedLyrics,
            timestamp * 1000 + lyricsData.offsetMs + lineLeadTimeMs,
        );

        // Clamp the scroll target to at most one line ahead of the highlighted
        // line. A large lead time over fast lyrics would otherwise scroll several
        // lines ahead and push the currently-sung line out of view.
        return Math.min(aheadIndex, activeIndex + 1);
    }, [activeIndex, lineLeadTimeMs, lyricsData.offsetMs, normalizedLyrics, timestamp]);

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const scrollLineRef = useRef<HTMLDivElement | null>(null);

    // Height-aware scroll anchor: place the scroll target at a fixed fraction of
    // the viewport height instead of `scrollIntoView({ block: 'center' })`.
    // `offsetTop` is measured against the scroll container (`position: relative`),
    // so the anchor holds at any window height — a very tall window keeps the
    // target near the center instead of letting it drift toward the top.
    const scrollToAnchor = useCallback(() => {
        const container = scrollContainerRef.current;
        const line = scrollLineRef.current;

        if (!container || !line) {
            return;
        }

        const lineCenter = line.offsetTop + line.offsetHeight / 2;
        const target = lineCenter - SCROLL_ANCHOR_FRACTION * container.clientHeight;
        container.scrollTo({ behavior: 'smooth', top: target });
    }, []);

    // Scroll when the target advances, and re-anchor after a resize (the browser
    // holds `scrollTop` across a resize, so the anchor drifts and needs restoring).
    useEffect(() => {
        if (isResizing) {
            return;
        }

        scrollToAnchor();
    }, [isResizing, scrollIndex, scrollToAnchor]);

    return (
        <div
            className={`desktop-lyrics-root${locked ? ' desktop-lyrics-locked' : ''}`}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
            style={rootStyle}
        >
            <DesktopLyricsControlBar locked={locked} onLock={handleLock} onUnlock={handleUnlock} />
            {normalizedLyrics?.length ? (
                <div className="desktop-lyrics-scroll" ref={scrollContainerRef}>
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
