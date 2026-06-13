import { useState, type ChangeEvent } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { electronApi } from '../../app/electronApi';
import { useAppConfig } from '../../app/providers';
import { UiSelect } from '../../components/ui';
import { templateRegistry } from './registry';

type TemplateSelectorProps = {
  activeTemplateId: string;
};

export function TemplateSelector({ activeTemplateId }: TemplateSelectorProps) {
  const { t } = useTranslation();
  const { refreshConfig } = useAppConfig();
  const [isSaving, setIsSaving] = useState(false);

  const templates = templateRegistry.getAll();
  const activeTemplate =
    templates.find((template) => template.metadata.id === activeTemplateId) ??
    templates[0];

  if (templates.length <= 1 || !activeTemplate) {
    return null;
  }

  const handleChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextTemplateId = event.target.value;

    if (nextTemplateId === activeTemplate.metadata.id) {
      return;
    }

    setIsSaving(true);

    try {
      await electronApi.settings.update({
        selectedDashboardTemplate: nextTemplateId,
      });
      await refreshConfig();
    } catch (error) {
      console.error('Failed to update dashboard template selection', error);
      // TODO: Show toast notification to user about the failure
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="dashboard-template-selector">
      <label
        className="dashboard-template-selector-label"
        htmlFor="dashboard-template-select"
      >
        <span className="dashboard-template-selector-title">
          <LayoutTemplate size={16} />
          {t('dashboard.templateSelectorLabel', 'Dashboard template')}
        </span>
        <UiSelect
          id="dashboard-template-select"
          className="dashboard-template-selector-input"
          value={activeTemplate.metadata.id}
          onChange={handleChange}
          disabled={isSaving}
        >
          {templates.map((template) => (
            <option key={template.metadata.id} value={template.metadata.id}>
              {t(template.metadata.name)}
            </option>
          ))}
        </UiSelect>
      </label>
      <p className="dashboard-template-selector-description">
        {t(activeTemplate.metadata.description)}
      </p>
    </div>
  );
}
