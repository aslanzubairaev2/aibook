"use client";

import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { saveLocalProfile } from "@/lib/db/local";
import { sbUpsertSettings } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import type { UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  onProfileChange: (p: UserProfile) => void;
};

export function SettingsView({ profile, onProfileChange }: Props) {
  const { user, signOut } = useAuth();

  async function setLang(field: "nativeLanguage" | "targetLanguage" | "ttsProvider" | "uiLanguage", value: string) {
    const updated = { ...profile, [field]: value };
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
              {profile.ttsProvider === "gemini" ? "Gemini TTS (Preview)" : "Локальный (Браузер)"}
            </div>
          </div>
          <select
            className="lang-select"
            value={profile.ttsProvider || "local"}
            onChange={(e) => void setLang("ttsProvider" as any, e.target.value)}
          >
            <option value="local">Локальный</option>
            <option value="gemini">Gemini TTS</option>
          </select>
        </div>
      </div>

      {/* Info */}
      <p className="setting-section-title">О приложении</p>
      <div className="settings-list" style={{ marginBottom: 24 }}>
        {[
          { label: "Версия", value: "1.1.0" },
          { label: "AI модель", value: "gemini-3.1-flash-lite" },
          { label: "Форматы книг", value: "TXT, EPUB" },
          { label: "Хранилище", value: "Supabase + LocalStorage cache" },
        ].map(({ label, value }) => (
          <div key={label} className="setting-row">
            <div className="setting-row-label">{label}</div>
            <div className="setting-row-value" style={{ fontSize: 13 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Sign out */}
      {user && (
        <button
          type="button"
          className="primary-btn"
          style={{ background: "rgba(196,106,106,0.15)", color: "var(--red)", border: "1px solid rgba(196,106,106,0.3)" }}
          onClick={() => void signOut()}
        >
          Выйти из аккаунта
        </button>
      )}
    </section>
  );
}
