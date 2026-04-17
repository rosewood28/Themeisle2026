import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import type { User } from "./api";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (user: User) => void;
  logout: () => void;
  updateUser: (updater: (user: User) => User) => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load user from localStorage on mount
    const token = localStorage.getItem("auth_token");
    const userData = localStorage.getItem("auth_user");

    if (token && userData) {
      try {
        const parsedUser = JSON.parse(userData);
        setUser({ ...parsedUser, token });
      } catch {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
      }
    }

    setIsLoading(false);
  }, []);

  const login = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem("auth_token", newUser.token);
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        balance: newUser.balance,
      }),
    );
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
  };

  const updateUser = (updater: (currentUser: User) => User) => {
    setUser((currentUser) => {
      if (!currentUser) return currentUser;
      const nextUser = updater(currentUser);
      localStorage.setItem("auth_token", nextUser.token);
      localStorage.setItem(
        "auth_user",
        JSON.stringify({
          id: nextUser.id,
          username: nextUser.username,
          email: nextUser.email,
          role: nextUser.role,
          balance: nextUser.balance,
        }),
      );
      return nextUser;
    });
  };

  const refreshUser = async () => {
    if (!user) return;

    try {
      const latest = await api.getCurrentUser();
      updateUser((currentUser) => ({
        ...currentUser,
        ...latest,
      }));
    } catch {
      // Keep existing session data; transient failures shouldn't force logout.
    }
  };

  useEffect(() => {
    if (!user) return;

    void refreshUser();

    const intervalId = window.setInterval(() => {
      void refreshUser();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [user?.id]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        updateUser,
        refreshUser,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
