"use client";

import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { saveLocalProfile } from "@/lib/db/local";
import type { UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  onProfileChange: (p: UserProfile) => void;
};

export function SettingsView({ profile, onProfileChange }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  function setLang(field: "nativeLanguage" | "targetLanguage", value: string) {
    const updated = { ...profile, [field]: value };
    saveLocalProfile(updated);
    onProfileChange(updated);
  }

  function handleSaveApiKey() {
    if (!apiKey.trim()) return;
    // In production: send to server or store encrypted
    // For MVP: store key in localStorage (user-provided key)
    localStorage.setItem("aibook_api_key", apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const hasStoredKey = typeof window !== "undefined" && Boolean(localStorage.getItem("aibook_api_key"));

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Профиль</p>
          <h1>Настройки</h1>
        </div>
      </header>

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
            onChange={(e) => setLang("nativeLanguage", e.target.value)}
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
            onChange={(e) => setLang("targetLanguage", e.target.value)}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.nameNative}</option>
            ))}
          </select>
        </div>
      </div>

      {/* API Key */}
      <p className="setting-section-title">AI · Gemini API</p>
      <div className="surface-card" style={{ padding: 16, marginBottom: 8 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Ключ хранится только в вашем браузере и используется для AI-анализа текста.
          {hasStoredKey && <span style={{ color: "var(--green)", marginLeft: 6 }}>✓ Ключ сохранён</span>}
        </p>
        <input
          className="api-key-input"
          type="password"
          placeholder="AIza..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <button
          className="primary-btn"
          type="button"
          onClick={handleSaveApiKey}
          disabled={!apiKey.trim()}
        >
          {saved ? <><Check size={16} /> Сохранено</> : "Сохранить ключ"}
        </button>
      </div>

      {/* Info */}
      <p className="setting-section-title">О приложении</p>
      <div className="settings-list">
        {[
          { label: "Версия", value: "1.0.0 MVP" },
          { label: "AI модель", value: "gemini-3.1-flash-lite" },
          { label: "Форматы книг", value: "TXT, EPUB" },
        ].map(({ label, value }) => (
          <div key={label} className="setting-row">
            <div className="setting-row-label">{label}</div>
            <div className="setting-row-value" style={{ fontSize: 13 }}>{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
