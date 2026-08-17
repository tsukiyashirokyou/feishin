import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDesktopLyricsConfigStore } from './desktop-lyrics-config.store';

import {
    DesktopLyricsSettingField,
    DesktopLyricsSettingValue,
} from '/@/shared/types/desktop-lyrics';

// The desktop lyrics renderer has no Mantine/theme provider, so this settings
// panel is built from native controls styled with plain CSS. It renders in-flow
// between the control bar and the lyric area (never as an absolute overlay), so
// opening it pushes the lyric area down instead of covering the current line.
// It is a read-only mirror's view of the authoritative settings: every change is
// sent as a `set-config` intent, which the main process relays to the main window
// renderer, whose config bridge writes the settings store and pushes the updated
// config back. The config store round-trip updates the controls here.

// The stored font color is either hex (`#ffffff`) or `rgb(r, g, b)` (from the
// system settings ColorInput). Native `<input type="color">` needs hex, so
// normalize rgb to hex for display; hex is passed through unchanged.
const toHexColor = (color: string): string => {
    const rgbMatch = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color.trim());

    if (!rgbMatch) {
        return color;
    }

    const toHex = (component: string) => Number(component).toString(16).padStart(2, '0');
    return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
};

export const DesktopLyricsSettingsPanel = () => {
    const { t } = useTranslation();
    const fontColor = useDesktopLyricsConfigStore((state) => state.fontColor);
    const fontSize = useDesktopLyricsConfigStore((state) => state.fontSize);
    const layout = useDesktopLyricsConfigStore((state) => state.layout);
    const [fontSizeDraft, setFontSizeDraft] = useState(fontSize);

    // The slider tracks a local draft so dragging is smooth (the authoritative
    // value only round-trips back after the pointer/key is released).
    useEffect(() => {
        setFontSizeDraft(fontSize);
    }, [fontSize]);

    const sendSetting = (field: DesktopLyricsSettingField, value: DesktopLyricsSettingValue) => {
        window.api.desktopLyrics.control({ field, type: 'set-config', value });
    };

    const commitFontSize = () => {
        sendSetting('fontSize', fontSizeDraft);
    };

    return (
        <div className="desktop-lyrics-settings-panel">
            <div className="desktop-lyrics-settings-title">{t('page.setting.desktopLyrics')}</div>
            <div className="desktop-lyrics-settings-row">
                <span className="desktop-lyrics-settings-label">
                    {t('setting.desktopLyricsFontSize')}
                </span>
                <div className="desktop-lyrics-settings-size-row">
                    <input
                        aria-label={t('setting.desktopLyricsFontSize')}
                        className="desktop-lyrics-settings-range"
                        max={64}
                        min={12}
                        onChange={(e) => setFontSizeDraft(Number(e.target.value))}
                        onKeyUp={commitFontSize}
                        onMouseUp={commitFontSize}
                        onTouchEnd={commitFontSize}
                        step={1}
                        type="range"
                        value={fontSizeDraft}
                    />
                    <span className="desktop-lyrics-settings-value">{fontSizeDraft}px</span>
                </div>
            </div>
            <div className="desktop-lyrics-settings-row">
                <span className="desktop-lyrics-settings-label">
                    {t('setting.desktopLyricsFontColor')}
                </span>
                <input
                    aria-label={t('setting.desktopLyricsFontColor')}
                    className="desktop-lyrics-settings-color"
                    onChange={(e) => sendSetting('fontColor', e.target.value)}
                    type="color"
                    value={toHexColor(fontColor)}
                />
            </div>
            <div className="desktop-lyrics-settings-row">
                <span className="desktop-lyrics-settings-label">
                    {t('setting.desktopLyricsLayout')}
                </span>
                <div className="desktop-lyrics-settings-segment">
                    <button
                        className={`desktop-lyrics-settings-segment-button${
                            layout === 'vertical'
                                ? ' desktop-lyrics-settings-segment-button-active'
                                : ''
                        }`}
                        onClick={() => sendSetting('layout', 'vertical')}
                        type="button"
                    >
                        {t('setting.desktopLyricsLayoutVertical')}
                    </button>
                    <button
                        className={`desktop-lyrics-settings-segment-button${
                            layout === 'horizontal'
                                ? ' desktop-lyrics-settings-segment-button-active'
                                : ''
                        }`}
                        onClick={() => sendSetting('layout', 'horizontal')}
                        type="button"
                    >
                        {t('setting.desktopLyricsLayoutHorizontal')}
                    </button>
                </div>
            </div>
        </div>
    );
};
