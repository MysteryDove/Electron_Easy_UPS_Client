import type {
  DashboardTemplate,
  DashboardTemplateComponent,
  DashboardTemplateMetadata,
} from './types';

export class DashboardTemplateRegistry {
  private readonly templates = new Map<string, DashboardTemplate>();

  public register(
    metadata: DashboardTemplateMetadata,
    Component: DashboardTemplateComponent,
  ): DashboardTemplate {
    const template = { metadata, Component };

    this.templates.set(metadata.id, template);

    return template;
  }

  public get(templateId: string): DashboardTemplate | undefined {
    return this.templates.get(templateId);
  }

  public getAll(): DashboardTemplate[] {
    return Array.from(this.templates.values());
  }

  public has(templateId: string): boolean {
    return this.templates.has(templateId);
  }
}

export const templateRegistry = new DashboardTemplateRegistry();
