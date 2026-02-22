import { useTranslation } from 'react-i18next';
import packageMeta from '../../../package.json';

const TECHNOLOGIES = ['Electron', 'React', 'TypeScript', 'Vite', 'DuckDB', 'i18next'] as const;

type PackageAuthor = string | { name?: string; email?: string };

export function AboutPage() {
    const { t } = useTranslation();

    const appName = packageMeta.productName || packageMeta.name;
    const appDescription = packageMeta.description || t('about.unknown');
    const appVersion = packageMeta.version || t('about.unknown');
    const appLicense = packageMeta.license || t('about.unknown');
    const builtWith = packageMeta.devDependencies?.electron || t('about.unknown');
    const author = formatAuthor(packageMeta.author as PackageAuthor | undefined, t('about.unknown'));

    return (
        <div className="about-page">
            <header className="page-header">
                <div>
                    <h1 className="page-title">{t('about.title')}</h1>
                    <span className="page-subtitle">{t('about.subtitle')}</span>
                </div>
            </header>

            <section className="settings-section">
                <h2 className="settings-section-title">{t('about.application')}</h2>
                <div className="about-details">
                    <div className="about-detail-row">
                        <span className="about-detail-label">{t('about.name')}</span>
                        <span className="about-detail-value">{appName}</span>
                    </div>
                    <div className="about-detail-row">
                        <span className="about-detail-label">{t('about.version')}</span>
                        <span className="about-detail-value">{appVersion}</span>
                    </div>
                    <div className="about-detail-row">
                        <span className="about-detail-label">{t('about.description')}</span>
                        <span className="about-detail-value">{appDescription}</span>
                    </div>
                    <div className="about-detail-row">
                        <span className="about-detail-label">{t('about.author')}</span>
                        <span className="about-detail-value">{author}</span>
                    </div>
                    <div className="about-detail-row">
                        <span className="about-detail-label">{t('about.license')}</span>
                        <span className="about-detail-value">{appLicense}</span>
                    </div>
                    <div className="about-detail-row">
                        <span className="about-detail-label">{t('about.builtWith')}</span>
                        <span className="about-detail-value">{builtWith}</span>
                    </div>
                </div>
            </section>

            <section className="settings-section">
                <h2 className="settings-section-title">{t('about.techStack')}</h2>
                <ul className="about-stack-list">
                    {TECHNOLOGIES.map((technology) => (
                        <li key={technology} className="about-stack-pill">
                            {technology}
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}

function formatAuthor(author: PackageAuthor | undefined, fallbackText: string): string {
    if (!author) {
        return fallbackText;
    }

    if (typeof author === 'string') {
        return author;
    }

    const name = author.name?.trim() ?? '';
    const email = author.email?.trim() ?? '';

    if (name && email) {
        return `${name} <${email}>`;
    }

    return name || email || fallbackText;
}
