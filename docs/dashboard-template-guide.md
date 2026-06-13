# Dashboard Template Development Guide

**Version**: 2.0.0  
**Last Updated**: 2026-06-08  
**Status**: Production Ready

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Data Provider API](#data-provider-api)
5. [Creating a Template](#creating-a-template)
6. [Template Registration](#template-registration)
7. [Best Practices](#best-practices)
8. [Examples](#examples)
9. [Troubleshooting](#troubleshooting)
10. [Advanced Topics](#advanced-topics)

---

## Overview

The dashboard template system allows you to create multiple UI designs for the home page while sharing the same unified data feed. Each template is a self-contained React component that consumes standardized UPS telemetry data through a clean API.

### Key Features

- **Unified Data Provider**: All templates access the same real-time UPS data through a single hook
- **Hot Switching**: Users can switch templates instantly without reloading the app
- **Persistent Selection**: Template choice is saved to settings and restored on app restart
- **Type-Safe**: Full TypeScript support with strict type checking
- **Zero IPC Knowledge Required**: Templates never interact with Electron IPC directly

### When to Create a New Template

- Different UI layouts (grid vs list vs single-column)
- Different metric emphasis (battery-focused vs power-quality-focused)
- Different user personas (technical vs simple overview)
- Different device types (desktop vs compact for small screens)
- Specialized use cases (data center monitoring vs home UPS)

---

## Quick Start

### 1. Create Template Component

Create a new file in `src/renderer/features/dashboard/templates/`:

```typescript
// src/renderer/features/dashboard/templates/MinimalTemplate.tsx
import { useDashboardDataContext } from '../DashboardDataProvider';

export function MinimalTemplate() {
  const data = useDashboardDataContext();

  return (
    <div className="dashboard-page">
      <h1>UPS Status</h1>
      <p>Battery: {data.telemetry.latest?.values.battery_charge_pct ?? '--'}%</p>
      <p>Load: {data.telemetry.latest?.values.ups_load_pct ?? '--'}%</p>
      <p>State: {data.connection.state}</p>
    </div>
  );
}
```

### 2. Register Template

Add registration to `src/renderer/features/dashboard/templates/index.ts`:

```typescript
import { registerTemplate } from '..';
import { MinimalTemplate } from './MinimalTemplate';

registerTemplate(
  {
    id: 'minimal',
    name: 'Minimal View',
    description: 'Simple overview with essential metrics only',
  },
  MinimalTemplate,
);
```

### 3. Done!

The template selector will automatically appear in the dashboard sidebar when the dashboard page is active and the sidebar is expanded.

---

## Architecture

### Data Flow

```
Main Process (NUT Polling)
  ↓
TelemetryRepository (DuckDB)
  ↓
IPC Events (real-time push)
  ↓
electronApi (Preload Bridge)
  ↓
AppProviders (React Context)
  ↓
useDashboardData() Hook
  ↓
DashboardDataProvider (Context)
  ↓
useDashboardDataContext() Hook
  ↓
Your Template Component
```

### Component Hierarchy

```
AppShell
  ├── Sidebar (TemplateSelector shown on /dashboard when expanded)
  └── DashboardPage (Container)
    └── DashboardDataProvider
      └── TemplateErrorBoundary
        └── [Active Template Component]
```

### Key Principles

1. **Separation of Concerns**: Templates render UI, data provider handles all data fetching/subscriptions
2. **Context-Based**: Data flows through React Context, not props
3. **Registry Pattern**: Templates self-register at module load time
4. **Container/Presentation**: DashboardPage is a container, templates are pure presentation

---

## Data Provider API

### The `useDashboardDataContext()` Hook

This is the **ONLY** way templates should access data. Never use `useConnection()`, `useAppConfig()`, or `electronApi` directly.

```typescript
import { useDashboardDataContext } from '../DashboardDataProvider';

function MyTemplate() {
  const data = useDashboardDataContext();
  
  // data is now available with full type safety
}
```

### Data Shape

The hook returns a `DashboardData` object with this structure:

```typescript
interface DashboardData {
  connection: {
    state: ConnectionState;           // 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
    lastUpdateTime: Date | null;      // Timestamp of last telemetry update
    isStale: boolean;                 // true if >15 seconds since last update
    driverIssue: LocalDriverLaunchIssue | null;  // Driver launch error if any
  };
  
  ups: {
    static: Record<string, string> | null;   // Static UPS properties (model, serial, etc.)
    dynamic: Record<string, string> | null;  // Dynamic properties (ups.status, ups.alarm)
  };
  
  telemetry: {
    latest: TelemetryDataPoint | null;       // Most recent telemetry reading
    history: TelemetryDataPoint[];           // Last 5 minutes of data (max 50 points)
    onUpdate: (callback) => () => void;      // Subscribe to real-time updates
  };
  
  config: AppConfig;                         // Application configuration
}
```

### TelemetryDataPoint Structure

```typescript
interface TelemetryDataPoint {
  ts: string;  // ISO 8601 timestamp
  values: {
    // Battery metrics
    battery_charge_pct?: number;
    battery_voltage?: number;
    battery_current?: number;
    
    // Input metrics
    input_voltage?: number;
    input_frequency_hz?: number;
    input_current?: number;
    
    // Output metrics
    output_voltage?: number;
    output_frequency_hz?: number;
    output_current?: number;
    
    // Load metrics
    ups_load_pct?: number;
    ups_realpower_watts?: number;
    ups_apparent_power_va?: number;
    
    // ... and more (see TelemetryValues type)
  };
}
```

### ConnectionState Values

| State | Meaning |
|-------|---------|
| `idle` | Initial state, no connection attempted |
| `connecting` | Attempting to connect to NUT daemon |
| `connected` | Successfully connected, receiving data |
| `disconnected` | Connection lost, attempting reconnect |
| `error` | Permanent connection error |

---

## Creating a Template

### Template Anatomy

A template is a React component that:
1. Calls `useDashboardDataContext()` to get data
2. Renders UI based on that data
3. Handles loading/error states gracefully
4. Follows existing design patterns

### Minimal Example

```typescript
import { useDashboardDataContext } from '../DashboardDataProvider';

export function SimpleTemplate() {
  const data = useDashboardDataContext();
  
  // Handle no data case
  if (!data.telemetry.latest) {
    return <div>Waiting for data...</div>;
  }
  
  return (
    <div className="dashboard-page">
      <h1>Battery Status</h1>
      <p>{data.telemetry.latest.values.battery_charge_pct}%</p>
    </div>
  );
}
```

### Accessing Configuration

Templates can read user configuration (voltage thresholds, locale, theme, etc.):

```typescript
const data = useDashboardDataContext();

const nominalVoltage = data.config.line.nominalVoltage;  // e.g., 220
const locale = data.config.i18n.locale;                  // e.g., 'en'
const themeMode = data.config.theme.mode;                // 'light' | 'dark' | 'system'
```

### Accessing Static UPS Data

Static data includes device model, serial number, manufacturer, etc.:

```typescript
const data = useDashboardDataContext();

const model = data.ups.static?.['device.model'];         // "Smart-UPS 1500"
const serial = data.ups.static?.['device.serial'];       // "AS1234567890"
const manufacturer = data.ups.static?.['device.mfr'];    // "APC"
const firmware = data.ups.static?.['ups.firmware'];      // "868.L4 .I"
```

### Accessing Dynamic UPS Data

Dynamic data includes current UPS status and alarms:

```typescript
const data = useDashboardDataContext();

const statusRaw = data.ups.dynamic?.['ups.status'];      // "OL CHRG"
const alarm = data.ups.dynamic?.['ups.alarm'];           // "Low battery!"
```

### Subscribing to Real-Time Updates

For live updates without re-rendering the entire component:

```typescript
import { useEffect } from 'react';
import { useDashboardDataContext } from '../DashboardDataProvider';

export function LiveTemplate() {
  const data = useDashboardDataContext();
  
  useEffect(() => {
    // Subscribe to telemetry updates
    const unsubscribe = data.telemetry.onUpdate((values) => {
      console.log('New battery charge:', values.battery_charge_pct);
      // Update local state, trigger animations, etc.
    });
    
    // Cleanup subscription on unmount
    return unsubscribe;
  }, [data.telemetry]);
  
  return <div>Live data component</div>;
}
```

### Using Historical Data

The `history` array contains up to 5 minutes of telemetry (max 50 points):

```typescript
const data = useDashboardDataContext();

// Get all battery voltage readings from last 5 minutes
const voltageHistory = data.telemetry.history
  .map(point => point.values.battery_voltage)
  .filter((v): v is number => typeof v === 'number');

// Average voltage over time window
const avgVoltage = voltageHistory.reduce((a, b) => a + b, 0) / voltageHistory.length;
```

### Handling Stale Data

Check if data is stale (>15 seconds since last update):

```typescript
const data = useDashboardDataContext();

if (data.connection.isStale) {
  return (
    <div className="stale-warning">
      ⚠️ Data may be outdated (last update: {data.connection.lastUpdateTime?.toLocaleTimeString()})
    </div>
  );
}
```

---

## Template Registration

### Registration Metadata

```typescript
interface DashboardTemplateMetadata {
  id: string;              // Unique identifier (lowercase, hyphens, no spaces)
  name: string;            // Display name shown in selector
  description: string;     // Brief description (shown below selector)
  previewImage?: string;   // Optional: path to preview thumbnail (future feature)
}
```

### Registration Example

```typescript
// src/renderer/features/dashboard/templates/index.ts
import { registerTemplate } from '..';
import { MyCustomTemplate } from './MyCustomTemplate';

registerTemplate(
  {
    id: 'my-custom',                    // Used in config, URLs, etc.
    name: 'My Custom Dashboard',        // Shown in dropdown
    description: 'Optimized for data center monitoring with focus on power quality metrics',
  },
  MyCustomTemplate,
);
```

### Registration Best Practices

1. **Unique IDs**: Use descriptive, URL-safe IDs (e.g., `battery-focus`, `compact-view`)
2. **Clear Names**: Names should be 2-4 words, describe the template's purpose
3. **Helpful Descriptions**: Mention key features or target use case
4. **Register Early**: Add registration to `templates/index.ts` so it loads before first render

---

## Best Practices

### 1. Handle Missing Data Gracefully

Always check for null/undefined before accessing telemetry values:

```typescript
// ❌ BAD: Will crash if data is null
const charge = data.telemetry.latest.values.battery_charge_pct;

// ✅ GOOD: Safe with fallback
const charge = data.telemetry.latest?.values.battery_charge_pct ?? 0;
```

### 2. Use Existing UI Components

Reuse components from the default template:

```typescript
import { SparklineCard } from '../../../components/SparklineCard';
import { UpsStatusBanner } from '../../../components/UpsStatusBanner';
```

### 3. Follow Internationalization (i18n)

Use translation keys instead of hardcoded strings:

```typescript
import { useTranslation } from 'react-i18next';

export function MyTemplate() {
  const { t } = useTranslation();
  const data = useDashboardDataContext();
  
  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      <p>{t('metrics.batteryCharge')}: {data.telemetry.latest?.values.battery_charge_pct}%</p>
    </div>
  );
}
```

### 4. Respect Theme Settings

Use CSS classes that respond to theme:

```typescript
// CSS automatically responds to .dark class on <html>
<div className="dashboard-page">  
  <div className="metric-card">  {/* Styles adapt to theme */}
    ...
  </div>
</div>
```

### 5. Performance Optimization

- Use `React.memo()` for expensive components
- Avoid creating new objects/arrays in render
- Memoize computed values with `useMemo()`

```typescript
import { useMemo } from 'react';

export function MyTemplate() {
  const data = useDashboardDataContext();
  
  // Memoize expensive calculation
  const averageLoad = useMemo(() => {
    const loads = data.telemetry.history
      .map(p => p.values.ups_load_pct)
      .filter((v): v is number => typeof v === 'number');
    return loads.reduce((a, b) => a + b, 0) / loads.length;
  }, [data.telemetry.history]);
  
  return <div>Average Load: {averageLoad.toFixed(1)}%</div>;
}
```

### 6. Accessibility

- Use semantic HTML (`<header>`, `<main>`, `<section>`)
- Provide `aria-label` for icon-only buttons
- Ensure sufficient color contrast
- Support keyboard navigation

```typescript
<button 
  aria-label="View battery details"
  onClick={handleClick}
>
  <Battery size={24} />
</button>
```

---

## Examples

### Example 1: Battery-Focused Template

```typescript
// BatteryFocusTemplate.tsx
import { useTranslation } from 'react-i18next';
import { Battery, Zap } from 'lucide-react';
import { useDashboardDataContext } from '../DashboardDataProvider';
import { SparklineCard } from '../../../components/SparklineCard';

export function BatteryFocusTemplate() {
  const { t } = useTranslation();
  const data = useDashboardDataContext();
  
  const charge = data.telemetry.latest?.values.battery_charge_pct;
  const voltage = data.telemetry.latest?.values.battery_voltage;
  const current = data.telemetry.latest?.values.battery_current;
  
  const chargeHistory = data.telemetry.history
    .map(p => p.values.battery_charge_pct)
    .filter((v): v is number => typeof v === 'number');
  
  if (!data.telemetry.latest) {
    return (
      <div className="dashboard-page">
        <p>{t('dashboard.waitingTelemetry')}</p>
      </div>
    );
  }
  
  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1>{t('dashboard.batteryFocus.title', 'Battery Status')}</h1>
      </header>
      
      <section className="battery-hero">
        <div className="battery-icon-large">
          <Battery size={64} />
        </div>
        <div className="battery-charge-large">
          {charge?.toFixed(1) ?? '--'}%
        </div>
      </section>
      
      <section className="dashboard-metrics">
        <div className="metrics-grid">
          <SparklineCard
            title={t('metrics.batteryCharge')}
            currentValue={charge ?? 0}
            unit="%"
            icon={<Battery size={16} />}
            data={chargeHistory}
            metricType="percent"
          />
          
          <SparklineCard
            title={t('metrics.batteryVoltage')}
            currentValue={voltage ?? 0}
            unit="V"
            icon={<Zap size={16} />}
            data={data.telemetry.history
              .map(p => p.values.battery_voltage)
              .filter((v): v is number => typeof v === 'number')}
            metricType="voltage"
          />
          
          <SparklineCard
            title={t('metrics.batteryCurrent')}
            currentValue={current ?? 0}
            unit="A"
            icon={<Zap size={16} />}
            data={data.telemetry.history
              .map(p => p.values.battery_current)
              .filter((v): v is number => typeof v === 'number')}
            metricType="current"
            applyMovingAverage
          />
        </div>
      </section>
    </div>
  );
}
```

### Example 2: Compact Single-Column Template

```typescript
// CompactTemplate.tsx
import { useTranslation } from 'react-i18next';
import { useDashboardDataContext } from '../DashboardDataProvider';

export function CompactTemplate() {
  const { t } = useTranslation();
  const data = useDashboardDataContext();
  
  const metrics = [
    { 
      key: 'battery_charge_pct', 
      label: t('metrics.batteryCharge'), 
      unit: '%' 
    },
    { 
      key: 'battery_voltage', 
      label: t('metrics.batteryVoltage'), 
      unit: 'V' 
    },
    { 
      key: 'ups_load_pct', 
      label: t('metrics.upsLoad'), 
      unit: '%' 
    },
    { 
      key: 'input_voltage', 
      label: t('metrics.inputVoltage'), 
      unit: 'V' 
    },
    { 
      key: 'output_voltage', 
      label: t('metrics.outputVoltage'), 
      unit: 'V' 
    },
  ];
  
  return (
    <div className="dashboard-page dashboard-page--compact">
      <header className="page-header">
        <h1>{t('dashboard.title')}</h1>
        <span className="connection-badge" data-state={data.connection.state}>
          {data.connection.state}
        </span>
      </header>
      
      <div className="compact-metrics">
        {metrics.map(metric => {
          const value = data.telemetry.latest?.values[metric.key];
          return (
            <div key={metric.key} className="compact-metric-row">
              <span className="compact-metric-label">{metric.label}</span>
              <span className="compact-metric-value">
                {typeof value === 'number' ? value.toFixed(1) : '--'} {metric.unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### Example 3: Real-Time Animated Template

```typescript
// AnimatedTemplate.tsx
import { useState, useEffect } from 'react';
import { useDashboardDataContext } from '../DashboardDataProvider';

export function AnimatedTemplate() {
  const data = useDashboardDataContext();
  const [flashClass, setFlashClass] = useState('');
  
  // Flash animation on telemetry update
  useEffect(() => {
    const unsubscribe = data.telemetry.onUpdate(() => {
      setFlashClass('metric-flash');
      setTimeout(() => setFlashClass(''), 500);
    });
    
    return unsubscribe;
  }, [data.telemetry]);
  
  const charge = data.telemetry.latest?.values.battery_charge_pct ?? 0;
  
  return (
    <div className="dashboard-page">
      <div className={`animated-charge ${flashClass}`}>
        <div 
          className="charge-bar" 
          style={{ width: `${charge}%` }}
        />
        <span className="charge-text">{charge.toFixed(1)}%</span>
      </div>
    </div>
  );
}
```

---

## Troubleshooting

### Template Not Appearing in Selector

**Problem**: Added a new template but it doesn't show in the dropdown.

**Solutions**:
1. Check registration is called in `templates/index.ts`
2. Verify `templates/index.ts` is imported in `DashboardPage.tsx` (line 3: `import '../features/dashboard/templates'`)
3. Check template ID is unique (no duplicates)
4. Ensure at least 2 templates are registered (selector hides with only 1 template)
5. Restart dev server (`npm run dev`)

### "Must be used within DashboardDataProvider" Error

**Problem**: `useDashboardDataContext()` throws error.

**Solutions**:
1. Only call the hook inside template components, not at module level
2. Verify `DashboardDataProvider` wraps your template in `DashboardPage.tsx`
3. Don't call the hook in components outside the dashboard

### Stale Data / No Updates

**Problem**: Template shows old data, doesn't update in real-time.

**Solutions**:
1. Check connection state: `data.connection.state === 'connected'`
2. Verify NUT daemon is running and accessible
3. Check `data.connection.isStale` flag
4. Ensure component re-renders when data changes (don't block React updates)

### TypeScript Errors

**Problem**: Type errors when accessing telemetry values.

**Solutions**:
1. Always use optional chaining: `data.telemetry.latest?.values.battery_charge_pct`
2. Filter out undefined values: `.filter((v): v is number => typeof v === 'number')`
3. Import types from `shared/ipc/contracts.ts`

### Performance Issues

**Problem**: Template causes lag or high CPU usage.

**Solutions**:
1. Memoize expensive calculations with `useMemo()`
2. Use `React.memo()` to prevent unnecessary re-renders
3. Avoid creating new objects/arrays in render
4. Limit chart data points (history is already capped at 50)
5. Debounce real-time update handlers

---

## Advanced Topics

### Custom Data Queries

Templates use the standard 5-minute history by default. For custom time ranges:

```typescript
import { electronApi } from '../../../app/electronApi';

// Query custom date range (direct IPC access - use sparingly)
const customData = await electronApi.telemetry.queryRange({
  startIso: new Date(Date.now() - 3600000).toISOString(),  // 1 hour ago
  endIso: new Date().toISOString(),
  columns: ['battery_charge_pct', 'ups_load_pct'],
  maxPoints: 100,
});
```

⚠️ **Warning**: Direct IPC access bypasses the data provider abstraction. Only use for advanced features not supported by `useDashboardDataContext()`.

### Template-Specific Styling

Add template-specific CSS:

```typescript
// MyTemplate.tsx
import './MyTemplate.css';  // Template-specific styles

export function MyTemplate() {
  return (
    <div className="my-template">  {/* Namespaced class */}
      ...
    </div>
  );
}
```

```css
/* MyTemplate.css */
.my-template {
  /* Styles scoped to this template */
}

.my-template .metric-card {
  /* Override default metric-card styles */
}
```

### Responsive Templates

Adapt layout to screen size:

```typescript
import { useState, useEffect } from 'react';

export function ResponsiveTemplate() {
  const [isCompact, setIsCompact] = useState(window.innerWidth < 768);
  
  useEffect(() => {
    const handleResize = () => setIsCompact(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  return (
    <div className={isCompact ? 'layout-compact' : 'layout-wide'}>
      ...
    </div>
  );
}
```

### Template with External Libraries

Integrate third-party charting libraries:

```typescript
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { useDashboardDataContext } from '../DashboardDataProvider';

export function ChartTemplate() {
  const data = useDashboardDataContext();
  const chartRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!chartRef.current) return;
    
    const chart = echarts.init(chartRef.current);
    
    chart.setOption({
      xAxis: { type: 'category', data: data.telemetry.history.map(p => p.ts) },
      yAxis: { type: 'value' },
      series: [{
        data: data.telemetry.history.map(p => p.values.battery_charge_pct),
        type: 'line',
      }],
    });
    
    return () => chart.dispose();
  }, [data.telemetry.history]);
  
  return <div ref={chartRef} style={{ width: '100%', height: '400px' }} />;
}
```

### Template Settings

Store template-specific preferences:

```typescript
// Future enhancement - not yet implemented
const [templateSettings, setTemplateSettings] = useTemplateSettings('my-template', {
  showAdvancedMetrics: false,
  refreshInterval: 5000,
});

// Settings would be stored per-template in config
```

---

## Appendix

### Available Telemetry Columns

| Column | Type | Description | Unit |
|--------|------|-------------|------|
| `battery_charge_pct` | number | Battery charge level | % |
| `battery_voltage` | number | Battery voltage | V |
| `battery_current` | number | Battery current (+ charging, - discharging) | A |
| `input_voltage` | number | Input line voltage | V |
| `input_frequency_hz` | number | Input line frequency | Hz |
| `input_current` | number | Input current | A |
| `output_voltage` | number | Output voltage | V |
| `output_frequency_hz` | number | Output frequency | Hz |
| `output_current` | number | Output current | A |
| `ups_load_pct` | number | UPS load percentage | % |
| `ups_realpower_watts` | number | Real power output | W |
| `ups_apparent_power_va` | number | Apparent power output | VA |
| `ups_status_num` | number | Legacy numeric status code | - |

### Common NUT Field Names (Static/Dynamic Data)

| Field | Location | Description |
|-------|----------|-------------|
| `device.model` | static | UPS model name |
| `device.serial` | static | Serial number |
| `device.mfr` | static | Manufacturer |
| `ups.firmware` | static | Firmware version |
| `ups.status` | dynamic | Status tokens (e.g., "OL CHRG") |
| `ups.alarm` | dynamic | Current alarm message |
| `battery.type` | static | Battery chemistry |
| `input.voltage.nominal` | static | Nominal input voltage |
| `output.voltage.nominal` | static | Nominal output voltage |

### File Structure Reference

```
src/renderer/features/dashboard/
├── index.ts                          # Barrel exports + registerTemplate()
├── types.ts                          # TypeScript type definitions
├── registry.ts                       # Template registry singleton
├── DashboardDataProvider.tsx         # Data context provider
├── TemplateSelector.tsx              # Dropdown component
├── hooks/
│   └── useDashboardData.ts          # Data fetching hook
└── templates/
    ├── index.ts                      # Template registrations
    ├── DefaultTemplate.tsx           # Built-in default template
    └── [YourCustomTemplate.tsx]      # Your custom templates here
```

---

## Contributing

When contributing a new template:

1. Follow the naming convention: `[Purpose]Template.tsx` (e.g., `BatteryFocusTemplate.tsx`)
2. Add JSDoc comments explaining the template's purpose
3. Include i18n keys in `src/locales/en.json` and `src/locales/zh.json`
4. Test with missing data, stale connections, and edge cases
5. Ensure accessibility (keyboard nav, ARIA labels, color contrast)
6. Add entry to this guide's Examples section

---

## License

This dashboard template system is part of the Electron Easy UPS Client.  
See project LICENSE for details.

---

**Need Help?**  
- Check existing templates in `src/renderer/features/dashboard/templates/` for examples
- Review the `DefaultTemplate.tsx` implementation for best practices
- Open an issue on the project repository for bugs or feature requests
