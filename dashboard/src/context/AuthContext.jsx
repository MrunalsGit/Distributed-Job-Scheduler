import { createContext, useContext, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));

  async function login(email, password) {
    const { data } = await api.login(email, password);
    localStorage.setItem('token', data.token);
    setToken(data.token);
  }

  async function signup(email, password) {
    await api.signup(email, password);
    await login(email, password);
  }

  function logout() {
    localStorage.removeItem('token');
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ token, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
