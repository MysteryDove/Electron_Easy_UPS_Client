import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import arLocale from '../locales/ar.json';
import daLocale from '../locales/da.json';
import deLocale from '../locales/de.json';
import enLocale from '../locales/en.json';
import esLocale from '../locales/es.json';
import fiLocale from '../locales/fi.json';
import frLocale from '../locales/fr.json';
import idLocale from '../locales/id.json';
import itLocale from '../locales/it.json';
import jaLocale from '../locales/ja.json';
import krLocale from '../locales/kr.json';
import nlLocale from '../locales/nl.json';
import plLocale from '../locales/pl.json';
import ptLocale from '../locales/pt.json';
import ruLocale from '../locales/ru.json';
import svLocale from '../locales/sv.json';
import thLocale from '../locales/th.json';
import trLocale from '../locales/tr.json';
import twLocale from '../locales/tw.json';
import ukLocale from '../locales/uk.json';
import viLocale from '../locales/vi.json';
import zhLocale from '../locales/zh.json';

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

function resolveSystemLocale(userLanguage: string): SupportedLocale {
    const normalizedLanguage = userLanguage.toLowerCase();

    if (
        normalizedLanguage === 'zh-tw'
        || normalizedLanguage === 'zh-hk'
        || normalizedLanguage === 'zh-mo'
        || normalizedLanguage.startsWith('zh-hant')
    ) {
        return 'tw';
    }

    if (
        normalizedLanguage === 'zh-cn'
        || normalizedLanguage === 'zh-sg'
        || normalizedLanguage.startsWith('zh-hans')
        || normalizedLanguage.startsWith('zh')
    ) {
        return 'zh';
    }

    if (normalizedLanguage.startsWith('ar')) return 'ar';
    if (normalizedLanguage.startsWith('da')) return 'da';
    if (normalizedLanguage.startsWith('de')) return 'de';
    if (normalizedLanguage.startsWith('es')) return 'es';
    if (normalizedLanguage.startsWith('fi')) return 'fi';
    if (normalizedLanguage.startsWith('fr')) return 'fr';
    if (normalizedLanguage === 'id' || normalizedLanguage === 'in' || normalizedLanguage.startsWith('id-')) return 'id';
    if (normalizedLanguage.startsWith('it')) return 'it';
    if (normalizedLanguage.startsWith('ja')) return 'ja';
    if (normalizedLanguage.startsWith('ko')) return 'kr';
    if (normalizedLanguage.startsWith('nl')) return 'nl';
    if (normalizedLanguage.startsWith('pl')) return 'pl';
    if (normalizedLanguage.startsWith('pt')) return 'pt';
    if (normalizedLanguage.startsWith('ru')) return 'ru';
    if (normalizedLanguage.startsWith('sv')) return 'sv';
    if (normalizedLanguage.startsWith('th')) return 'th';
    if (normalizedLanguage.startsWith('tr')) return 'tr';
    if (normalizedLanguage.startsWith('uk')) return 'uk';
    if (normalizedLanguage.startsWith('vi')) return 'vi';

    return 'en';
}

const fallbackSystem = resolveSystemLocale(navigator.language);

void i18next
    .use(initReactI18next)
    .init({
        resources,
        lng: fallbackSystem,
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false,
        },
    });

i18next.on('languageChanged', (lng) => {
    if (lng === 'ar') {
        document.documentElement.dir = 'rtl';
        document.documentElement.lang = 'ar';
    } else {
        document.documentElement.dir = 'ltr';
        document.documentElement.lang = lng;
    }
});

if (fallbackSystem === 'ar') {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
} else {
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = fallbackSystem;
}

export default i18next;
export { fallbackSystem };
