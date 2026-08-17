import isElectron from 'is-electron';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { useDesktopLyricsSettings, useSettingsStoreActions } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { ColorInput } from '/@/shared/components/color-input/color-input';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { Slider } from '/@/shared/components/slider/slider';
import { Switch } from '/@/shared/components/switch/switch';

// Desktop lyrics settings. `enabled` is the source of truth for open/close: the
// main window renderer's config bridge pushes these values to the main process,
// which reconciles the desktop lyrics window accordingly. The "unlock" button is
// the external escape hatch for the locked (mouse-through) window state.
export const DesktopLyricsSettings = memo(() => {
    const { t } = useTranslation();
    const settings = useDesktopLyricsSettings();
    const { setSettings } = useSettingsStoreActions();

    const updateSetting = (updates: Partial<typeof settings>) => {
        setSettings({
            lyrics: {
                desktopLyrics: {
                    ...settings,
                    ...updates,
                },
            },
        });
    };

    const options: SettingOption[] = [
        {
            control: (
                <Switch
                    aria-label="Enable desktop lyrics"
                    checked={settings.enabled}
                    onChange={(e) => updateSetting({ enabled: e.currentTarget.checked })}
                />
            ),
            description: t('setting.desktopLyricsEnable', {
                context: 'description',
            }),
            isHidden: !isElectron(),
            title: t('setting.desktopLyricsEnable'),
        },
        {
            control: (
                <Button
                    disabled={!settings.enabled}
                    onClick={() => window.api.desktopLyrics.control({ type: 'unlock' })}
                    size="compact-sm"
                >
                    {t('setting.desktopLyricsUnlock')}
                </Button>
            ),
            description: t('setting.desktopLyricsUnlock', {
                context: 'description',
            }),
            isHidden: !isElectron(),
            title: t('setting.desktopLyricsUnlock'),
        },
        {
            control: (
                <Slider
                    defaultValue={settings.fontSize}
                    label={(value) => `${value}px`}
                    max={64}
                    min={12}
                    onChangeEnd={(value) => updateSetting({ fontSize: value })}
                    step={1}
                    w={120}
                />
            ),
            description: t('setting.desktopLyricsFontSize', {
                context: 'description',
            }),
            isHidden: !isElectron(),
            title: t('setting.desktopLyricsFontSize'),
        },
        {
            control: (
                <ColorInput
                    defaultValue={settings.fontColor}
                    format="rgb"
                    onChangeEnd={(value) => updateSetting({ fontColor: value })}
                    swatchesPerRow={5}
                    withEyeDropper={false}
                />
            ),
            description: t('setting.desktopLyricsFontColor', {
                context: 'description',
            }),
            isHidden: !isElectron(),
            title: t('setting.desktopLyricsFontColor'),
        },
        {
            control: (
                <NumberInput
                    defaultValue={settings.lineLeadTimeMs}
                    max={1000}
                    min={0}
                    onBlur={(e) => {
                        const value = Number(e.currentTarget.value);
                        updateSetting({ lineLeadTimeMs: value });
                    }}
                    step={50}
                    width={100}
                />
            ),
            description: t('setting.desktopLyricsLineLeadTime', {
                context: 'description',
            }),
            isHidden: !isElectron(),
            title: t('setting.desktopLyricsLineLeadTime'),
        },
        {
            control: (
                <Switch
                    aria-label="Always on top"
                    defaultChecked={settings.alwaysOnTop}
                    onChange={(e) => updateSetting({ alwaysOnTop: e.currentTarget.checked })}
                />
            ),
            description: t('setting.desktopLyricsAlwaysOnTop', {
                context: 'description',
            }),
            isHidden: !isElectron(),
            title: t('setting.desktopLyricsAlwaysOnTop'),
        },
    ];

    return <SettingsSection options={options} title={t('page.setting.desktopLyrics')} />;
});
