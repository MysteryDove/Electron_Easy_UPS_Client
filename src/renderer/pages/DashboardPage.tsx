import { useEffect } from 'react';
import { useAppConfig } from '../app/providers';
import { TemplateErrorBoundary } from '../components/TemplateErrorBoundary';
import '../features/dashboard/templates';
import {
  DashboardDataProvider,
  TemplateSelector,
  templateRegistry,
} from '../features/dashboard';

const FALLBACK_TEMPLATE_ID = 'default';

export function DashboardPage() {
  const { config } = useAppConfig();
  const requestedTemplateId =
    config?.selectedDashboardTemplate ?? FALLBACK_TEMPLATE_ID;
  const fallbackTemplate =
    templateRegistry.get(FALLBACK_TEMPLATE_ID) ?? templateRegistry.getAll()[0];
  const activeTemplate =
    templateRegistry.get(requestedTemplateId) ?? fallbackTemplate;

  useEffect(() => {
    if (!activeTemplate) {
      console.error('No dashboard templates are registered');
      return;
    }

    if (!templateRegistry.has(requestedTemplateId)) {
      console.warn(
        `Unknown dashboard template "${requestedTemplateId}", falling back to "${activeTemplate.metadata.id}"`,
      );
    }
  }, [activeTemplate, requestedTemplateId]);

  if (!activeTemplate) {
    return null;
  }

  const ActiveTemplate = activeTemplate.Component;

  return (
    <DashboardDataProvider>
      <div className="dashboard-template-page">
        <TemplateSelector activeTemplateId={activeTemplate.metadata.id} />
        <TemplateErrorBoundary>
          <div key={activeTemplate.metadata.id} className="dashboard-template-shell">
            <ActiveTemplate />
          </div>
        </TemplateErrorBoundary>
      </div>
    </DashboardDataProvider>
  );
}
