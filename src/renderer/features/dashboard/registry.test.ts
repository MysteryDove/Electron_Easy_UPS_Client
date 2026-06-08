import { describe, expect, it } from 'vitest';
import { DashboardTemplateRegistry } from './registry';

function ExampleTemplate(): null {
  return null;
}

describe('DashboardTemplateRegistry', () => {
  it('registers and resolves templates by id', () => {
    const registry = new DashboardTemplateRegistry();

    registry.register(
      {
        id: 'default',
        name: 'Default Dashboard',
        description: 'Comprehensive UPS monitoring',
      },
      ExampleTemplate,
    );

    expect(registry.has('default')).toBe(true);
    expect(registry.get('default')?.Component).toBe(ExampleTemplate);
    expect(registry.get('default')?.metadata).toEqual({
      id: 'default',
      name: 'Default Dashboard',
      description: 'Comprehensive UPS monitoring',
    });
    expect(registry.getAll()).toHaveLength(1);
  });
});
