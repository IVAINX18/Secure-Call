import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LogoProvider } from './contexts/LogoContext';
import { RoleProvider } from './contexts/RoleContext';
import { VerificationProvider } from './contexts/VerificationContext';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import VideoCall from './pages/VideoCall';
import Settings from './pages/Settings';
import BiometricEnroll from './pages/BiometricEnroll';
import BiometricVerify from './pages/BiometricVerify';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

function App() {
  return (
    <Router>
      <AuthProvider>
        <LogoProvider>
          <RoleProvider>
            <VerificationProvider>
              <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/login/biometric-verify" element={<BiometricVerify />} />
                <Route element={<Layout />}>
                  <Route 
                    path="/dashboard" 
                    element={
                      <ProtectedRoute>
                        <Dashboard />
                      </ProtectedRoute>
                    } 
                  />
                  <Route
                    path="/settings/biometric-enroll"
                    element={
                      <ProtectedRoute>
                        <BiometricEnroll />
                      </ProtectedRoute>
                    }
                  />
                  <Route 
                    path="/video-call/:roomId?" 
                    element={
                      <ProtectedRoute>
                        <VideoCall />
                      </ProtectedRoute>
                    } 
                  />
                </Route>
              </Routes>
            </VerificationProvider>
          </RoleProvider>
        </LogoProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;