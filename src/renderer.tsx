import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './renderer/app/providers';
import { AppRoutes } from './renderer/app/routes';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  </StrictMode>,
);
