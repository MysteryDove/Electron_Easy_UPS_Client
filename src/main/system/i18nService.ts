import i18next from 'i18next';
import { app } from 'electron';
import type { AppConfig } from '../config/configSchema';
import arLocale from '../../locales/ar.json';
import daLocale from '../../locales/da.json';
import deLocale from '../../locales/de.json';
import enLocale from '../../locales/en.json';
import esLocale from '../../locales/es.json';
import fiLocale from '../../locales/fi.json';
import frLocale from '../../locales/fr.json';
import idLocale from '../../locales/id.json';
import itLocale from '../../locales/it.json';
import jaLocale from '../../locales/ja.json';
import krLocale from '../../locales/kr.json';
import nlLocale from '../../locales/nl.json';
import plLocale from '../../locales/pl.json';
import ptLocale from '../../locales/pt.json';
import ruLocale from '../../locales/ru.json';
import svLocale from '../../locales/sv.json';
import thLocale from '../../locales/th.json';
import trLocale from '../../locales/tr.json';
import twLocale from '../../locales/tw.json';
import ukLocale from '../../locales/uk.json';
import viLocale from '../../locales/vi.json';
import zhLocale from '../../locales/zh.json';

const resources = {
    ar: { translation: arLocale },
    da: { translation: daLocale },
    de: { translation: deLocale },
    en: { translation: enLocale },
    es: { translation: esLocale },
    fi: { translation: fiLocale },
    fr: { translation: frLocale },
    id: { translation: idLocale },
    it: { translation: itLocale },
    ja: { translation: jaLocale },
    kr: { translation: krLocale },
    nl: { translation: nlLocale },
    pl: { translation: plLocale },
    pt: { translation: ptLocale },
    ru: { translation: ruLocale },
    sv: { translation: svLocale },
    th: { translation: thLocale },
    tr: { translation: trLocale },
    tw: { translation: twLocale },
    uk: { translation: ukLocale },
    vi: { translation: viLocale },
    zh: { translation: zhLocale },
};

type SupportedLocale = keyof typeof resources;
type TranslationOptions = Record<string, unknown> & { defaultValue?: string };

function resolveSystemLocale(systemLocale: string): SupportedLocale {
    const normalizedLocale = systemLocale.toLowerCase();

    if (
        normalizedLocale === 'zh-tw'
        || normalizedLocale === 'zh-hk'
        || normalizedLocale === 'zh-mo'
        || normalizedLocale.startsWith('zh-hant')
    ) {
        return 'tw';
    }

    if (
        normalizedLocale === 'zh-cn'
        || normalizedLocale === 'zh-sg'
        || normalizedLocale.startsWith('zh-hans')
        || normalizedLocale.startsWith('zh')
    ) {
        return 'zh';
    }

    if (normalizedLocale.startsWith('ar')) return 'ar';
    if (normalizedLocale.startsWith('da')) return 'da';
    if (normalizedLocale.startsWith('de')) return 'de';
    if (normalizedLocale.startsWith('es')) return 'es';
    if (normalizedLocale.startsWith('fi')) return 'fi';
    if (normalizedLocale.startsWith('fr')) return 'fr';
    if (normalizedLocale === 'id' || normalizedLocale === 'in' || normalizedLocale.startsWith('id-')) return 'id';
    if (normalizedLocale.startsWith('it')) return 'it';
    if (normalizedLocale.startsWith('ja')) return 'ja';
    if (normalizedLocale.startsWith('ko')) return 'kr';
    if (normalizedLocale.startsWith('nl')) return 'nl';
    if (normalizedLocale.startsWith('pl')) return 'pl';
    if (normalizedLocale.startsWith('pt')) return 'pt';
    if (normalizedLocale.startsWith('ru')) return 'ru';
    if (normalizedLocale.startsWith('sv')) return 'sv';
    if (normalizedLocale.startsWith('th')) return 'th';
    if (normalizedLocale.startsWith('tr')) return 'tr';
    if (normalizedLocale.startsWith('uk')) return 'uk';
    if (normalizedLocale.startsWith('vi')) return 'vi';

    return 'en';
}

function resolveLocaleToUse(config: AppConfig): string {
    return config.i18n.locale === 'system'
        ? resolveSystemLocale(app.getLocale())
        : config.i18n.locale;
}

export class I18nService {
    private lastLocale = 'en';

    public async start(config: AppConfig): Promise<void> {
        const localeToUse = resolveLocaleToUse(config);
        this.lastLocale = localeToUse;

        await i18next.init({
            lng: localeToUse,
            fallbackLng: 'en',
            resources,
            interpolation: {
                escapeValue: false,
            },
        });
    }

    public async handleConfigUpdated(config: AppConfig): Promise<void> {
        const localeToUse = resolveLocaleToUse(config);

        if (this.lastLocale !== localeToUse) {
            this.lastLocale = localeToUse;
            await i18next.changeLanguage(localeToUse);
        }
    }
}

export const i18nService = new I18nService();

export function t(key: string, options?: TranslationOptions): string {
    if (!i18next.isInitialized) {
        return options?.defaultValue ?? key;
    }

    return i18next.t(key, options);
}

export function subscribeToLangChange(callback: () => void): () => void {
    i18next.on('languageChanged', callback);

    return () => {
        i18next.off('languageChanged', callback);
    };
}
