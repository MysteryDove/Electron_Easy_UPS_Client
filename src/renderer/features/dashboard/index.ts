import { templateRegistry } from './registry';
import type {
  DashboardTemplateComponent,
  DashboardTemplateMetadata,
} from './types';

export { DashboardDataProvider, useDashboardDataContext } from './DashboardDataProvider';
export { useDashboardData } from './hooks/useDashboardData';
export { DashboardTemplateRegistry, templateRegistry } from './registry';
export { TemplateSelector } from './TemplateSelector';
export type {
  DashboardData,
  DashboardDataProviderProps,
  DashboardTemplate,
  DashboardTemplateComponent,
  DashboardTemplateMetadata,
  DashboardTelemetryUpdateCallback,
} from './types';

export function registerTemplate(
  metadata: DashboardTemplateMetadata,
  Component: DashboardTemplateComponent,
) {
  return templateRegistry.register(metadata, Component);
}
