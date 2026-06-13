import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useDashboardData } from './hooks/useDashboardData';
import type { DashboardData, DashboardDataProviderProps } from './types';

const DashboardDataContext = createContext<DashboardData | null>(null);

export function DashboardDataProvider({
  children,
}: DashboardDataProviderProps) {
  const { t } = useTranslation();
  const data = useDashboardData();

  if (!data) {
    return (
      <div className="page-loading">
        <span className="page-subtitle">
          {t('dashboard.loading', 'Loading dashboard...')}
        </span>
      </div>
    );
  }

  return (
    <DashboardDataContext.Provider value={data}>
      {children}
    </DashboardDataContext.Provider>
  );
}

export function useDashboardDataContext(): DashboardData {
  const context = useContext(DashboardDataContext);

  if (!context) {
    throw new Error(
      'useDashboardDataContext must be used within DashboardDataProvider',
    );
  }

  return context;
}
