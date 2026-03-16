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

function LoginGuard() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <BrowserRouter>
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
            <Route path="adjudicacion/:id/comite" element={<CommitteeDashboard />} />

            {/* Module 2: Ejecución */}
            <Route path="ejecucion" element={<ExecutionPage />} />

            {/* Module 3: Cierre y Liquidación */}
            <Route path="cierre" element={<ClosurePage />} />

            {/* Module AI: Motor de IA */}
            <Route path="ia" element={<AIPage />} />

            {/* Future modules */}
            <Route path="planificacion" element={<PlaceholderPage />} />
            <Route path="indicadores" element={<PlaceholderPage />} />
            <Route path="configuracion" element={<PlaceholderPage />} />
            <Route path="admin/usuarios" element={<AdminUsersPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
