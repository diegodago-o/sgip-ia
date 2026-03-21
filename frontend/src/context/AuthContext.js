import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('sgip_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('sgip_token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await authAPI.me();
      setUser(data.user);
      localStorage.setItem('sgip_user', JSON.stringify(data.user));
    } catch {
      localStorage.removeItem('sgip_token');
      localStorage.removeItem('sgip_user');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const login = async (email, password) => {
    const { data } = await authAPI.login(email, password);
    localStorage.setItem('sgip_token', data.token);
    localStorage.setItem('sgip_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('sgip_token');
    localStorage.removeItem('sgip_user');
    setUser(null);
  };

  // Called after OAuth callback — token + user already provided by backend redirect
  const loginWithToken = (token, userData) => {
    localStorage.setItem('sgip_token', token);
    localStorage.setItem('sgip_user', JSON.stringify(userData));
    setUser(userData);
  };

  return (
    <AuthContext.Provider value={{ user, login, loginWithToken, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
