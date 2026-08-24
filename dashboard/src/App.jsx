import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import QueuePage from './pages/QueuePage.jsx';
import JobDetailPage from './pages/JobDetailPage.jsx';
import WorkersPage from './pages/WorkersPage.jsx';
import DlqPage from './pages/DlqPage.jsx';
import MetricsPage from './pages/MetricsPage.jsx';

function RequireAuth({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<ProjectsPage />} />
                <Route path="/queues/:queueId" element={<QueuePage />} />
                <Route path="/jobs/:jobId" element={<JobDetailPage />} />
                <Route path="/workers" element={<WorkersPage />} />
                <Route path="/dlq" element={<DlqPage />} />
                <Route path="/metrics" element={<MetricsPage />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
