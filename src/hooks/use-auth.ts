import React, { useState, useEffect } from "react";
import { api } from "../api";

export type Auth = ReturnType<typeof useAuth>;

/** Shared-account session check and login form state. */
export function useAuth(enterStudio: () => Promise<void>) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  useEffect(() => {
    api("/session")
      .then(async (session) => {
        if (session.authenticated) {
          setAuthenticated(true);
          await enterStudio();
        }
      })
      .catch((e) => setLoginError(e.message))
      .finally(() => setCheckingSession(false));
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (loggingIn) return;
    setLoggingIn(true);
    setLoginError("");
    try {
      await api("/login", "POST", { username, password });
      setPassword("");
      setAuthenticated(true);
      await enterStudio();
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  }
  return {
    authenticated,
    checkingSession,
    username,
    setUsername,
    password,
    setPassword,
    loginError,
    loggingIn,
    login,
  };
}
