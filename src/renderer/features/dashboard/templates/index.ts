import { registerTemplate } from '../index';
import { DefaultTemplate } from './DefaultTemplate';
import { CardOverviewTemplate } from './CardOverviewTemplate';
import { PowerQualityTemplate } from './PowerQualityTemplate';
import { BatteryFocusTemplate } from './BatteryFocusTemplate';
import { InputUpsOutputTemplate } from './InputUpsOutputTemplate';
import { MinimalGlanceTemplate } from './MinimalGlanceTemplate';

// Register Default template (original design)
registerTemplate(
  {
    id: 'default',
    name: 'dashboard.templateDefault',
    description: 'dashboard.templateDefaultDesc',
  },
  DefaultTemplate,
);

// Register CardOverview template
registerTemplate(
  {
    id: 'card-overview',
    name: 'dashboard.templateCardOverview',
    description: 'dashboard.templateCardOverviewDesc',
  },
  CardOverviewTemplate,
);

// Register PowerQuality template
registerTemplate(
  {
    id: 'power-quality',
    name: 'dashboard.templatePowerQuality',
    description: 'dashboard.templatePowerQualityDesc',
  },
  PowerQualityTemplate,
);

// Register BatteryFocus template
registerTemplate(
  {
    id: 'battery-focus',
    name: 'dashboard.templateBatteryFocus',
    description: 'dashboard.templateBatteryFocusDesc',
  },
  BatteryFocusTemplate,
);

// Register InputUpsOutput template
registerTemplate(
  {
    id: 'input-ups-output',
    name: 'dashboard.templateInputUpsOutput',
    description: 'dashboard.templateInputUpsOutputDesc',
  },
  InputUpsOutputTemplate,
);

// Register MinimalGlance template
registerTemplate(
  {
    id: 'minimal-glance',
    name: 'dashboard.templateMinimalGlance',
    description: 'dashboard.templateMinimalGlanceDesc',
  },
  MinimalGlanceTemplate,
);
