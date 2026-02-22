import i18next from 'i18next';
import { app } from 'electron';
import type { AppConfig } from '../config/configSchema';
import enLocale from '../../locales/en.json';
import zhLocale from '../../locales/zh.json';

export class I18nService {
    private lastLocale = 'en';

    public async start(config: AppConfig): Promise<void> {
        const systemLocale = app.getLocale();
        const isZh = systemLocale.startsWith('zh');
        const resolvedSystem = isZh ? 'zh' : 'en';

        const localeToUse = config.i18n.locale === 'system' ? resolvedSystem : config.i18n.locale;
        this.lastLocale = localeToUse;

        await i18next.init({
            lng: localeToUse,
            fallbackLng: 'en',
            resources: {
                en: { translation: enLocale },
                zh: { translation: zhLocale }
            },
            interpolation: {
                escapeValue: false // not needed for node/react
            }
        });
    }

    public async handleConfigUpdated(config: AppConfig): Promise<void> {
        const systemLocale = app.getLocale();
        const isZh = systemLocale.startsWith('zh');
        const resolvedSystem = isZh ? 'zh' : 'en';

        const localeToUse = config.i18n.locale === 'system' ? resolvedSystem : config.i18n.locale;

        if (this.lastLocale !== localeToUse) {
            this.lastLocale = localeToUse;
            await i18next.changeLanguage(localeToUse);
        }
    }
}

export const i18nService = new I18nService();

export function t(key: string, options?: Record<string, unknown>): string {
    if (!i18next.isInitialized) {
        return key;
    }
    return i18next.t(key, options);
}

export function subscribeToLangChange(callback: () => void): () => void {
    i18next.on('languageChanged', callback);
    return () => {
        i18next.off('languageChanged', callback);
    };
}
