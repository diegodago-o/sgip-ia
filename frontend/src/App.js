import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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
import ConfiguracionPage from './pages/ConfiguracionPage';

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

        <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
          {/* Dashboard */}
          <Route index element={<DashboardPage />} />

          {/* Module 1: Adjudicación */}
          <Route path="adjudicacion" element={<ProjectListPage />} />
          <Route path="adjudicacion/nuevo" element={<ProjectFormPage />} />
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
          <Route path="indicadores" element={<PlaceholderPage />} />
          <Route path="configuracion" element={<ConfiguracionPage />} />
          <Route path="admin/usuarios" element={<AdminUsersPage />} />
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
        {/* /firma/corr/:token must come BEFORE /firma/:token to avoid route collision */}
        <Route path="/firma/corr/:token" element={<CorrespondenceSigningPage />} />
        <Route path="/firma/:token" element={<SigningPage />} />

        {/* Everything else goes through auth */}
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}
