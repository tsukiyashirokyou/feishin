import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    const [locked, setLocked] = useState(false);

    // Locking is a one-way transition in this phase: once locked, the window is
    // click-through (`setIgnoreMouseEvents(true)`), so the control bar is hidden
    // and there is no in-window way to unlock. Unlocking (via the main window's
    // settings/toggle) is deferred to Phase 6B.
    const handleLock = useCallback(() => {
        setLocked(true);
        window.api.desktopLyrics.control({ type: 'lock' });
    }, []);

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
            <div className="desktop-lyrics-root">
                <div className="desktop-lyrics-empty">{t('page.fullscreenPlayer.noLyrics')}</div>
                {!locked && <DesktopLyricsControlBar onLock={handleLock} />}
            </div>
        );
    }

    return (
        <div className="desktop-lyrics-root">
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
