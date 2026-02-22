import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enLocale from '../locales/en.json';
import zhLocale from '../locales/zh.json';

const userLanguage = navigator.language;
const isZh = userLanguage.toLowerCase().startsWith('zh');
const fallbackSystem = isZh ? 'zh' : 'en';

void i18next
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: enLocale },
            zh: { translation: zhLocale },
        },
        lng: fallbackSystem,
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false,
        },
    });

export default i18next;
export { fallbackSystem };
