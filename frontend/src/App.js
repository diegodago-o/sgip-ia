import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

/** Guard: redirects to / if user's role is not in allowedRoles */
function RoleGuard({ allowedRoles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

const DASHBOARD_ROLES = ['admin', 'director_pmo', 'ceo'];

/** Redirect root / based on role — roles without Dashboard go to /adjudicacion */
function HomeRedirect() {
  const { user } = useAuth();
  const role = user?.role || 'apoyo';
  if (DASHBOARD_ROLES.includes(role)) return <DashboardPage />;
  return <Navigate to="/adjudicacion" replace />;
}
import LoginPage from './components/auth/LoginPage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import DashboardPage from './components/pages/DashboardPage';
import ProjectListPage from './components/pages/ProjectListPage';
import ProjectFormPage from './components/pages/ProjectFormPage';
import ProjectDetailPage from './components/pages/ProjectDetailPage';
import PlaceholderPage from './components/pages/PlaceholderPage';
import ExecutionPage from './components/pages/ExecutionPage';
import ClosurePage from './components/pages/ClosurePage';
import AIPage from './components/pages/AIPage';
import AdminUsersPage from './components/pages/AdminUsersPage';
import CommitteeDashboard from './components/pages/CommitteeDashboard';
import SigningPage from './components/pages/SigningPage';
import CorrespondenceSigningPage from './components/pages/CorrespondenceSigningPage';
import FirmaLibrePage from './components/pages/FirmaLibrePage';
import OAuthCallbackPage from './components/auth/OAuthCallbackPage';
import ConfiguracionPage from './pages/ConfiguracionPage';
import IndicadoresPage from './components/pages/IndicadoresPage';

function LoginGuard() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

/** All authenticated routes wrapped in AuthProvider */
function AuthenticatedApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginGuard />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

        <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
          {/* Dashboard — solo admin / director_pmo / ceo, el resto va a /adjudicacion */}
          <Route index element={<HomeRedirect />} />

          {/* Module 1: Adjudicación */}
          <Route path="adjudicacion" element={<ProjectListPage />} />
          <Route path="adjudicacion/nuevo" element={
            <RoleGuard allowedRoles={['admin', 'gerente_proyecto']}>
              <ProjectFormPage />
            </RoleGuard>
          } />
          <Route path="adjudicacion/:id" element={<ProjectDetailPage />} />
          <Route path="adjudicacion/:id/editar" element={<ProjectFormPage />} />
          {/* Module 2: Ejecución */}
          <Route path="ejecucion" element={<ExecutionPage />} />
          <Route path="ejecucion/:id/comite" element={<CommitteeDashboard />} />

          {/* Module 3: Cierre y Liquidación */}
          <Route path="cierre" element={<ClosurePage />} />

          {/* Module AI: Motor de IA */}
          <Route path="ia" element={<AIPage />} />

          {/* Future modules */}
          <Route path="planificacion" element={<PlaceholderPage />} />
          <Route path="indicadores" element={<IndicadoresPage />} />
          <Route path="configuracion" element={
            <RoleGuard allowedRoles={['admin']}>
              <ConfiguracionPage />
            </RoleGuard>
          } />
          <Route path="admin/usuarios" element={
            <RoleGuard allowedRoles={['admin']}>
              <AdminUsersPage />
            </RoleGuard>
          } />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ PUBLIC — completely outside AuthProvider, no auth context, no loading state */}
        {/* Order matters: more specific routes first */}
        <Route path="/firma/corr/:token"  element={<CorrespondenceSigningPage />} />
        <Route path="/firma/libre/:token" element={<FirmaLibrePage />} />
        <Route path="/firma/:token"       element={<SigningPage />} />

        {/* Everything else goes through auth */}
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}
