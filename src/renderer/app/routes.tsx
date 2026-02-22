import {
    HashRouter,
    Routes,
    Route,
    Navigate,
    Outlet,
} from 'react-router-dom';
import { useAppConfig } from './providers';
import { AppShell } from '../components/AppShell';
import { SetupWizardPage } from '../pages/SetupWizardPage';
import { DashboardPage } from '../pages/DashboardPage';
import { TelemetryPage } from '../pages/TelemetryPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AboutPage } from '../pages/AboutPage';
import { ReconnectOverlay } from '../components/ReconnectOverlay';

function WizardGuard() {
    const { config } = useAppConfig();

    if (!config) {
        return null; // loading
    }

    if (!config.wizard.completed) {
        return <Navigate to="/wizard" replace />;
    }

    return (
        <>
            <ReconnectOverlay />
            <AppShell>
                <Outlet />
            </AppShell>
        </>
    );
}

function WizardRoute() {
    const { config } = useAppConfig();

    if (!config) {
        return null;
    }

    return <SetupWizardPage />;
}

export function AppRoutes() {
    return (
        <HashRouter>
            <Routes>
                <Route path="/wizard" element={<WizardRoute />} />
                <Route element={<WizardGuard />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/telemetry" element={<TelemetryPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/about" element={<AboutPage />} />
                </Route>
                <Route path="*" element={<RootRedirect />} />
            </Routes>
        </HashRouter>
    );
}

function RootRedirect() {
    const { config } = useAppConfig();

    if (!config) {
        return null;
    }

    return (
        <Navigate
            to={config.wizard.completed ? '/dashboard' : '/wizard'}
            replace
        />
    );
}
