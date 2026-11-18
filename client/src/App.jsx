import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute from './components/ProtectedRoute';

import Login from './pages/Login';
import SMODashboard from './pages/SMODashboard';
import ManagerDashboard from './pages/ManagerDashboard';
import AdminDashboard from './pages/AdminDashboard';

// Root redirect handler based on authenticated user's role
const RootRedirect = () => {
  const { isAuthenticated, role, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'manager') return <Navigate to="/manager" replace />;
  return <Navigate to="/smo" replace />;
};

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public Route */}
            <Route path="/login" element={<Login />} />

            {/* Role-Protected Routes */}
            <Route
              path="/smo"
              element={
                <ProtectedRoute allowedRoles={['smo', 'admin']}>
                  <SMODashboard />
                </ProtectedRoute>
              }
            />

            {/* Backward compatibility for /creator -> /smo */}
            <Route path="/creator" element={<Navigate to="/smo" replace />} />

            <Route
              path="/manager"
              element={
                <ProtectedRoute allowedRoles={['manager', 'admin']}>
                  <ManagerDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager', 'smo']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/clients"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager', 'smo']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            {/* Dynamic Root Route */}
            <Route path="/" element={<RootRedirect />} />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
