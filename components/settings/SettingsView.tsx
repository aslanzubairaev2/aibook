"use client";

import { useState } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { 
  saveLocalProfile, 
  getLocalAiProvider, 
  saveLocalAiProvider, 
  getLocalGeminiKey, 
  saveLocalGeminiKey 
} from "@/lib/db/local";
import { sbUpsertSettings } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import { getTtsProviderLabel, isDeepgramTtsSupported } from "@/lib/ttsProviders";
import type { TtsProvider, UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  onProfileChange: (p: UserProfile) => void;
  onNavigate?: (section: any) => void;
};

export function SettingsView({ profile, onProfileChange, onNavigate }: Props) {
  const { user, signOut } = useAuth();
  
  const [aiProvider, setAiProvider] = useState<"off" | "custom">(() => getLocalAiProvider());
  const [geminiKey, setGeminiKey] = useState<string>(() => getLocalGeminiKey());
  const [showKey, setShowKey] = useState(false);

  function handleAiProviderChange(val: "off" | "custom") {
    setAiProvider(val);
    saveLocalAiProvider(val);
  }

  function handleGeminiKeyChange(val: string) {
    setGeminiKey(val);
    saveLocalGeminiKey(val);
  }

  async function setLang(field: "nativeLanguage" | "targetLanguage" | "ttsProvider" | "uiLanguage", value: string) {
    const updated: UserProfile = { ...profile, [field]: value };
    if (field === "targetLanguage" && updated.ttsProvider === "deepgram" && !isDeepgramTtsSupported(value)) {
      updated.ttsProvider = "local";
    }
    saveLocalProfile(updated);
    onProfileChange(updated);

    // Sync to Supabase
    if (user) {
      await sbUpsertSettings({
        user_id: user.id,
        native_language: updated.nativeLanguage,
        active_target_lang: updated.targetLanguage,
        ui_language: updated.uiLanguage,
        tts_provider: updated.ttsProvider ?? "local",
        reading_minutes: updated.readingMinutes,
        books_started: updated.booksStarted,
        books_finished: updated.booksFinished,
        updated_at: new Date().toISOString(),
      });
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Профиль</p>
          <h1>Настройки</h1>
        </div>
      </header>

      {/* Account info */}
      {user && (
        <>
          <p className="setting-section-title">Аккаунт</p>
          <div className="settings-list" style={{ marginBottom: 20 }}>
            <div className="setting-row">
              <div>
                <div className="setting-row-label">Email</div>
                <div className="setting-row-value" style={{ fontSize: 14, fontWeight: 600 }}>{user.email}</div>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-row-label" style={{ fontSize: 13 }}>Синхронизация активна</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)", display: "block" }} />
                <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 700 }}>Supabase</span>
              </div>
            </div>
          </div>

          <p className="setting-section-title">Интеграция AI</p>
          <div className="settings-list" style={{ marginBottom: 20 }}>
            <div className="setting-row">
              <div>
                <div className="setting-row-label">Использовать AI</div>
                <div className="setting-row-value">
                  {aiProvider === "off" ? "Выключен" : "Свой ключ Gemini"}
                </div>
              </div>
              <select
                className="lang-select"
                value={aiProvider}
                onChange={(e) => handleAiProviderChange(e.target.value as "off" | "custom")}
              >
                <option value="off">Выключен</option>
                <option value="custom">Свой ключ Gemini API</option>
              </select>
            </div>

            {aiProvider === "custom" && (
              <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="setting-row-label">Gemini API Key</div>
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{ background: "none", border: "none", color: "var(--color-primary, #6366f1)", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
                  >
                    {showKey ? "Скрыть" : "Показать"}
                  </button>
                </div>
                <input
                  type={showKey ? "text" : "password"}
                  value={geminiKey}
                  onChange={(e) => handleGeminiKeyChange(e.target.value)}
                  placeholder="AIzaSy..."
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    color: "#fff",
                    fontSize: 13,
                    fontFamily: "monospace"
                  }}
                />
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: "1.4", margin: 0 }}>
                  Ключ сохраняется исключительно на вашем устройстве в локальном хранилище и никогда не отправляется на сервер или в базу данных.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Languages */}
      <p className="setting-section-title">Языки</p>
      <div className="settings-list" style={{ marginBottom: 20 }}>
        <div className="setting-row">
          <div>
            <div className="setting-row-label">Родной язык</div>
            <div className="setting-row-value">
              {SUPPORTED_LANGUAGES.find((l) => l.code === profile.nativeLanguage)?.nameNative ?? profile.nativeLanguage}
            </div>
          </div>
          <select
            className="lang-select"
            value={profile.nativeLanguage}
            onChange={(e) => void setLang("nativeLanguage", e.target.value)}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.nameNative}</option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-row-label">Изучаемый язык</div>
            <div className="setting-row-value">
              {SUPPORTED_LANGUAGES.find((l) => l.code === profile.targetLanguage)?.nameNative ?? profile.targetLanguage}
            </div>
          </div>
          <select
            className="lang-select"
            value={profile.targetLanguage}
            onChange={(e) => void setLang("targetLanguage", e.target.value)}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.nameNative}</option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-row-label">Голосовой движок</div>
            <div className="setting-row-value">
              {getTtsProviderLabel(profile.ttsProvider ?? "local")}
            </div>
          </div>
          <select
            className="lang-select"
            value={profile.ttsProvider === "deepgram" && !isDeepgramTtsSupported(profile.targetLanguage) ? "local" : profile.ttsProvider || "local"}
            onChange={(e) => void setLang("ttsProvider", e.target.value as TtsProvider)}
          >
            <option value="local">Локальный</option>
            <option value="gemini">Gemini TTS</option>
            {isDeepgramTtsSupported(profile.targetLanguage) && (
              <option value="deepgram">Deepgram Aura</option>
            )}
          </select>
        </div>
      </div>

      {/* Info */}
      <p className="setting-section-title">О приложении</p>
      <div className="settings-list" style={{ marginBottom: 24 }}>
        {[
          { label: "Версия", value: "1.1.0" },
          { label: "AI модель", value: "gemini-3.1-flash-lite" },
          { label: "Форматы книг", value: "TXT, EPUB, FB2" },
          { label: "Хранилище", value: "Supabase + LocalStorage cache" },
        ].map(({ label, value }) => (
          <div key={label} className="setting-row">
            <div className="setting-row-label">{label}</div>
            <div className="setting-row-value" style={{ fontSize: 13 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Sign out / Sign in */}
      {user ? (
        <button
          type="button"
          className="primary-btn"
          style={{ background: "rgba(196,106,106,0.15)", color: "var(--red)", border: "1px solid rgba(196,106,106,0.3)" }}
          onClick={() => void signOut()}
        >
          Выйти из аккаунта
        </button>
      ) : (
        <div style={{ marginTop: 24 }}>
          <p className="setting-section-title">Синхронизация данных</p>
          <div style={{ padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)", marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: "1.5", marginBottom: 12 }}>
              Данные сохраняются только на этом устройстве. Войдите, чтобы синхронизировать.
            </p>
            <button
              type="button"
              className="primary-btn"
              onClick={() => onNavigate?.("auth")}
            >
              Войти или зарегистрироваться
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
