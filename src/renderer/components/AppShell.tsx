import { NavLink } from 'react-router-dom';
import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnection } from '../app/providers';
import { LayoutDashboard, Activity, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

const NAV_ITEMS = [
    { to: '/dashboard', labelKey: 'appShell.navDashboard', icon: <LayoutDashboard size={20} /> },
    { to: '/telemetry', labelKey: 'appShell.navTelemetry', icon: <Activity size={20} /> },
    { to: '/settings', labelKey: 'appShell.navSettings', icon: <Settings size={20} /> },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const { state } = useConnection();
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <div className="app-shell">
            {/* Sidebar */}
            <aside className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''}`}>
                <div className="sidebar-brand">
                    <button
                        className="sidebar-toggle"
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        title={isCollapsed ? t('appShell.expandSidebar') : t('appShell.collapseSidebar')}
                    >
                        {isCollapsed ? <PanelLeftOpen size={24} /> : <PanelLeftClose size={24} />}
                    </button>
                </div>

                <nav className="sidebar-nav">
                    {NAV_ITEMS.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) =>
                                `sidebar-link ${isActive ? 'sidebar-link--active' : ''}`
                            }
                            title={isCollapsed ? t(item.labelKey) : undefined}
                        >
                            <span className="sidebar-link-icon">{item.icon}</span>
                            {!isCollapsed && <span className="sidebar-link-label">{t(item.labelKey)}</span>}
                        </NavLink>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <div className={`connection-badge connection-badge--${state}`} title={isCollapsed ? formatState(state, t) : undefined}>
                        <span className="connection-badge-dot" />
                        {!isCollapsed && <span className="connection-badge-label">{formatState(state, t)}</span>}
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className="main-content">{children}</main>
        </div>
    );
}

import type { TFunction } from 'i18next';

function formatState(state: string, t: TFunction): string {
    switch (state) {
        case 'idle':
            return t('appShell.stateDisconnected');
        case 'connecting':
            return t('appShell.stateConnecting');
        case 'initializing':
            return t('appShell.stateInitializing');
        case 'ready':
            return t('appShell.stateConnected');
        case 'degraded':
            return t('appShell.stateDegraded');
        case 'reconnecting':
            return t('appShell.stateReconnecting');
        default:
            return state;
    }
}
