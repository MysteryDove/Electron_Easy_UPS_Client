import { registerTemplate } from '..';
import { DefaultTemplate } from './DefaultTemplate';

export { DefaultTemplate } from './DefaultTemplate';

registerTemplate(
  {
    id: 'default',
    name: 'Default Dashboard',
    description:
      'Comprehensive UPS monitoring with sparkline charts and real-time metrics',
  },
  DefaultTemplate,
);