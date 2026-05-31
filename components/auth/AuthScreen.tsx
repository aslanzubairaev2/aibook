"use client";

import { useState } from "react";
import { BookOpen, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";

export function AuthScreen({ onBack }: { onBack?: () => void }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (!email || !password) { setError("Заполните email и пароль"); return; }
    if (password.length < 6) { setError("Пароль должен быть не менее 6 символов"); return; }

    setIsLoading(true);
    try {
      if (mode === "login") {
        const err = await signIn(email, password);
        if (err) setError(translateError(err));
      } else {
        const err = await signUp(email, password);
        if (err) {
          setError(translateError(err));
        } else {
          setSuccessMsg("Аккаунт создан! Проверьте почту для подтверждения, или войдите сразу если подтверждение отключено.");
          setMode("login");
        }
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ position: "relative" }}>
        {onBack && (
          <button
            type="button"
            className="auth-back-btn"
            onClick={onBack}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Закрыть
          </button>
        )}
        {/* Logo */}
        <div className="auth-logo">
          <BookOpen size={32} />
        </div>
        <h1 className="auth-title">AIBook</h1>
        <p className="auth-subtitle">Читайте и изучайте языки</p>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab${mode === "login" ? " active" : ""}`}
            onClick={() => { setMode("login"); setError(null); setSuccessMsg(null); }}
          >
            Войти
          </button>
          <button
            type="button"
            className={`auth-tab${mode === "register" ? " active" : ""}`}
            onClick={() => { setMode("register"); setError(null); setSuccessMsg(null); }}
          >
            Создать аккаунт
          </button>
        </div>

        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              className="auth-input"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete={mode === "login" ? "email" : "email"}
              disabled={isLoading}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-password">Пароль</label>
            <div className="auth-input-wrap">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                className="auth-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                disabled={isLoading}
              />
              <button
                type="button"
                className="auth-eye-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <div className="auth-error">{error}</div>}
          {successMsg && <div className="auth-success">{successMsg}</div>}

          <button type="submit" className="primary-btn" disabled={isLoading}>
            {isLoading
              ? <Loader2 size={18} className="auth-spinner" />
              : mode === "login" ? "Войти" : "Создать аккаунт"
            }
          </button>
        </form>
      </div>
    </div>
  );
}

// Translate common Supabase error messages to Russian
function translateError(msg: string): string {
  if (msg.includes("Invalid login credentials")) return "Неверный email или пароль";
  if (msg.includes("Email not confirmed")) return "Подтвердите email перед входом";
  if (msg.includes("User already registered")) return "Этот email уже зарегистрирован";
  if (msg.includes("Password should be at least")) return "Пароль должен быть не менее 6 символов";
  if (msg.includes("Unable to validate email")) return "Некорректный email адрес";
  if (msg.includes("rate limit")) return "Слишком много попыток. Подождите немного";
  return msg;
}
