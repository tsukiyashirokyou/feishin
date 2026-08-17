import { useTranslation } from 'react-i18next';
import {
    RiCloseLine,
    RiLayoutLeft2Line,
    RiLayoutTop2Line,
    RiLockFill,
    RiLockUnlockFill,
    RiPauseFill,
    RiPlayFill,
    RiSettingsLine,
    RiSkipBackFill,
    RiSkipForwardFill,
} from 'react-icons/ri';

import { useDesktopLyricsConfigStore } from './desktop-lyrics-config.store';
import { useDesktopLyricsStore } from './desktop-lyrics.store';

import { DesktopLyricsControlAction } from '/@/shared/types/desktop-lyrics';
import { PlayerStatus } from '/@/shared/types/types';

interface DesktopLyricsControlBarProps {
    locked: boolean;
    onLock: () => void;
    onToggleSettings: () => void;
    onUnlock: () => void;
    settingsOpen: boolean;
}

const sendControl = (action: DesktopLyricsControlAction) => {
    window.api.desktopLyrics.control(action);
};

// Compact icon-only control bar shown on hover. The desktop lyrics root is
// `-webkit-app-region: drag`, so this bar and its buttons are explicitly
// `no-drag` (in CSS) to stay clickable. Player controls are sent as intents via
// `desktop-lyrics-control`; the main process relays them to the main window's
// existing `renderer-player-*` channels. While locked the window is mouse-through
// except for the transient hover reveal, so the bar collapses to a single
// "unlock" action — the player controls are irrelevant until the window is
// interactive again.
export const DesktopLyricsControlBar = ({
    locked,
    onLock,
    onToggleSettings,
    onUnlock,
    settingsOpen,
}: DesktopLyricsControlBarProps) => {
    const { t } = useTranslation();
    const status = useDesktopLyricsStore((state) => state.status);
    const layout = useDesktopLyricsConfigStore((state) => state.layout);
    const isPlaying = status === PlayerStatus.PLAYING;

    if (locked) {
        return (
            <div className="desktop-lyrics-control-bar">
                <button className="desktop-lyrics-control-button" onClick={onUnlock} type="button">
                    <RiLockUnlockFill size={18} />
                </button>
            </div>
        );
    }

    // The layout toggle is a direct switch — it never opens settings. It writes
    // through the same `set-config` intent the settings panel uses, so the
    // authoritative store and the read-only mirror stay in sync.
    const handleToggleLayout = () => {
        sendControl({
            field: 'layout',
            type: 'set-config',
            value: layout === 'vertical' ? 'horizontal' : 'vertical',
        });
    };

    return (
        <div className="desktop-lyrics-control-bar">
            <button
                className="desktop-lyrics-control-button"
                onClick={() => sendControl({ type: 'previous' })}
                type="button"
            >
                <RiSkipBackFill size={18} />
            </button>
            <button
                className="desktop-lyrics-control-button"
                onClick={() => sendControl({ type: 'toggle-play' })}
                type="button"
            >
                {isPlaying ? <RiPauseFill size={20} /> : <RiPlayFill size={20} />}
            </button>
            <button
                className="desktop-lyrics-control-button"
                onClick={() => sendControl({ type: 'next' })}
                type="button"
            >
                <RiSkipForwardFill size={18} />
            </button>
            <button
                aria-label={t('setting.desktopLyricsSettings')}
                className={`desktop-lyrics-control-button${
                    settingsOpen ? ' desktop-lyrics-control-button-active' : ''
                }`}
                onClick={onToggleSettings}
                title={t('setting.desktopLyricsSettings')}
                type="button"
            >
                <RiSettingsLine size={18} />
            </button>
            <button
                aria-label={t('setting.desktopLyricsLayoutToggle')}
                className="desktop-lyrics-control-button"
                onClick={handleToggleLayout}
                title={t('setting.desktopLyricsLayoutToggle')}
                type="button"
            >
                {layout === 'vertical' ? (
                    <RiLayoutTop2Line size={18} />
                ) : (
                    <RiLayoutLeft2Line size={18} />
                )}
            </button>
            <button className="desktop-lyrics-control-button" onClick={onLock} type="button">
                <RiLockFill size={18} />
            </button>
            <button
                className="desktop-lyrics-control-button"
                onClick={() => sendControl({ type: 'close' })}
                type="button"
            >
                <RiCloseLine size={20} />
            </button>
        </div>
    );
};
