import {
    RiCloseLine,
    RiLockFill,
    RiPauseFill,
    RiPlayFill,
    RiSkipBackFill,
    RiSkipForwardFill,
} from 'react-icons/ri';

import { useDesktopLyricsStore } from './desktop-lyrics.store';

import { DesktopLyricsControlAction } from '/@/shared/types/desktop-lyrics';
import { PlayerStatus } from '/@/shared/types/types';

interface DesktopLyricsControlBarProps {
    onLock: () => void;
}

const sendControl = (action: DesktopLyricsControlAction) => {
    window.api.desktopLyrics.control(action);
};

// Compact icon-only control bar shown on hover. The desktop lyrics root is
// `-webkit-app-region: drag`, so this bar and its buttons are explicitly
// `no-drag` (in CSS) to stay clickable. Player controls are sent as intents via
// `desktop-lyrics-control`; the main process relays them to the main window's
// existing `renderer-player-*` channels. The window is only interactive while
// unlocked, so the bar always renders the "lock" action — unlocking from within
// is impossible once the window is click-through (see Phase 6A notes).
export const DesktopLyricsControlBar = ({ onLock }: DesktopLyricsControlBarProps) => {
    const status = useDesktopLyricsStore((state) => state.status);
    const isPlaying = status === PlayerStatus.PLAYING;

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
