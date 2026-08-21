import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44, supabase } from '@/api/base44Client';

/**
 * AuthContext — เขียนใหม่ให้ใช้ Supabase Auth (email + password)
 * รักษา interface เดิมที่ App.jsx ใช้: isLoadingAuth, isLoadingPublicSettings,
 * authError, navigateToLogin — จึงไม่ต้องแก้ที่อื่น
 */
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  const loadUser = async () => {
    try {
      const me = await base44.auth.me();
      setUser(me);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (e) {
      setUser(null);
      setIsAuthenticated(false);
      // profile ถูกปิดใช้งาน (inactive) → เทียบเท่า user_not_registered เดิม
      setAuthError({ type: e?.status === 403 ? 'user_not_registered' : 'auth_required', message: e?.message });
    } finally {
      setIsLoadingAuth(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session) {
        loadUser();
      } else {
        setIsLoadingAuth(false);
        setAuthError({ type: 'auth_required' });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session) loadUser();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({ type: 'auth_required' });
      }
    });

    return () => { mounted = false; subscription?.unsubscribe(); };
  }, []);

  const logout = async () => { await base44.auth.logout(window.location.href); };
  const navigateToLogin = () => { window.location.href = '/login'; };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,   // คงไว้เพื่อความเข้ากันได้กับ App.jsx เดิม
      authError,
      appPublicSettings: null,
      logout,
      navigateToLogin,
      checkAppState: loadUser,
      refreshUser: loadUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
