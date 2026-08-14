"use client";

import { useEffect, useState } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { 
  saveLocalProfile, 
  getLocalAiProvider, 
  saveLocalAiProvider, 
  getLocalGeminiKey, 
  saveLocalGeminiKey 
} from "@/lib/db/local";
import { sbUpsertSettings, sbAuthHeaders } from "@/lib/db/supabase";
import { getLastTtsError, getVoiceSample, speak } from "@/lib/tts";
import { useAuth } from "@/lib/auth/useAuth";
import {
  getAvailableTtsProviders,
  getStaticTtsVoices,
  getTtsProviderLabel,
  supportsVoiceChoice,
  type TtsVoiceOption,
} from "@/lib/ttsProviders";
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

  // The engine actually in force: a stored one the language cannot speak is not
  // the one that will be used, so the voice list must follow the real choice.
  const availableProviders = getAvailableTtsProviders(profile.targetLanguage);
  const activeProvider: TtsProvider = availableProviders.includes(profile.ttsProvider ?? "local")
    ? (profile.ttsProvider ?? "local")
    : "local";

  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [samplePlaying, setSamplePlaying] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  useEffect(() => {
    setVoicesError(null);

    if (!supportsVoiceChoice(activeProvider)) {
      setVoices([]);
      return;
    }

    // Gemini and GPT-4o ship their cast with the model — no round trip needed.
    const fixed = getStaticTtsVoices(activeProvider);
    if (fixed) {
      setVoices(fixed);
      return;
    }

    // Cartesia and ElevenLabs keep theirs in the account, behind our key.
    let cancelled = false;
    setVoicesLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/tts/voices?provider=${activeProvider}`, {
          headers: await sbAuthHeaders(),
        });
        const data = await res.json() as { voices?: TtsVoiceOption[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setVoices([]);
          setVoicesError(data.error ?? `Не удалось загрузить голоса (${res.status}).`);
          return;
        }
        setVoices(data.voices ?? []);
      } catch {
        if (!cancelled) {
          setVoices([]);
          setVoicesError("Не удалось загрузить голоса.");
        }
      } finally {
        if (!cancelled) setVoicesLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeProvider]);

  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);

  async function loadMcpUrl() {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const res = await fetch("/api/mcp-token", { headers: await sbAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось получить ссылку.");
      setMcpUrl(data.url as string);
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : "Не удалось получить ссылку.");
    } finally {
      setMcpLoading(false);
    }
  }

  async function copyMcpUrl() {
    if (!mcpUrl) return;
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setMcpCopied(true);
      setTimeout(() => setMcpCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable in some webviews; the URL stays visible to select by hand.
    }
  }

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
    // A voice the new target language has no support for would silently do
    // nothing; drop back to the browser voice instead.
    if (field === "targetLanguage" && !getAvailableTtsProviders(value).includes(updated.ttsProvider ?? "local")) {
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
        tts_voices: (updated.ttsVoices ?? {}) as Record<string, string>,
        reading_minutes: updated.readingMinutes,
        books_started: updated.booksStarted,
        books_finished: updated.booksFinished,
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Fall back to the first voice offered, so the box never shows an empty slot
  // for an engine whose stored voice belongs to a different one.
  const storedVoice = profile.ttsVoices?.[activeProvider];
  const selectedVoice = voices.some((v) => v.id === storedVoice) ? storedVoice! : voices[0]?.id ?? "";

  /**
   * Play the sample line in whichever voice is selected.
   *
   * `speak()` reads the choice back out of the saved profile, so this runs
   * after the save rather than beside it.
   */
  async function playSample() {
    setSampleError(null);
    setSamplePlaying(true);
    try {
      await speak(getVoiceSample(profile.targetLanguage), profile.targetLanguage);
      // A refusal still ends in the browser voice, so say what went wrong.
      setSampleError(getLastTtsError());
    } catch {
      setSampleError("Не удалось воспроизвести пример.");
    } finally {
      setSamplePlaying(false);
    }
  }

  /** Remember the voice for this engine only — each engine has its own cast. */
  async function setVoice(voiceId: string) {
    const ttsVoices = { ...profile.ttsVoices, [activeProvider]: voiceId };
    const updated: UserProfile = { ...profile, ttsVoices };
    saveLocalProfile(updated);
    onProfileChange(updated);

    // Hearing it immediately is the point of the picker: the names mean
    // nothing until you have heard them next to each other.
    void playSample();

    if (user) {
      await sbUpsertSettings({
        user_id: user.id,
        native_language: updated.nativeLanguage,
        active_target_lang: updated.targetLanguage,
        ui_language: updated.uiLanguage,
        tts_provider: updated.ttsProvider ?? "local",
        tts_voices: ttsVoices as Record<string, string>,
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

          <p className="setting-section-title">Подключение ИИ‑агентов (MCP)</p>
          <div className="settings-list" style={{ marginBottom: 20 }}>
            <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, padding: "14px 16px" }}>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: "1.5", margin: 0 }}>
                Личная ссылка, по которой ChatGPT, Claude или другой ИИ подключается к приложению.
                Он увидит ваш словарь, пачки слов и то, что вам плохо запоминается, — и сможет
                добавлять карточки, собирать новые пачки и писать тексты прямо в «Мои уроки».
              </p>

              {!mcpUrl && (
                <button
                  type="button"
                  className="primary-btn"
                  disabled={mcpLoading}
                  onClick={() => void loadMcpUrl()}
                >
                  {mcpLoading ? "Получаю…" : "Показать мою ссылку"}
                </button>
              )}

              {mcpError && (
                <p style={{ fontSize: 12, color: "var(--red)", margin: 0 }}>{mcpError}</p>
              )}

              {mcpUrl && (
                <>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontFamily: "monospace",
                      fontSize: 11,
                      color: "rgba(255,255,255,0.85)",
                      wordBreak: "break-all",
                      userSelect: "all",
                    }}
                  >
                    {mcpUrl}
                  </div>
                  <button type="button" className="primary-btn" onClick={() => void copyMcpUrl()}>
                    {mcpCopied ? "✓ Скопировано" : "Скопировать ссылку"}
                  </button>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: "1.5", margin: 0 }}>
                    Как подключить: в ChatGPT — Settings → Apps &amp; Connectors → включить Developer mode → Create,
                    вставить ссылку, аутентификация «None». В Claude — Settings → Connectors → Add custom connector.
                    <br />
                    Эта ссылка — ключ к вашим данным в приложении: не публикуйте её и не отправляйте в общие чаты.
                  </p>
                </>
              )}
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
              {getTtsProviderLabel(profile.ttsProvider ?? "local")}
            </div>
          </div>
          <select
            className="lang-select"
            value={activeProvider}
            onChange={(e) => void setLang("ttsProvider", e.target.value as TtsProvider)}
          >
            {/* Derived rather than written out: a hand-kept copy of this list
                is how ElevenLabs came to be missing from it. */}
            {availableProviders.map((provider) => (
              <option key={provider} value={provider}>{getTtsProviderLabel(provider)}</option>
            ))}
          </select>
        </div>

        {supportsVoiceChoice(activeProvider) && (
          <div className="setting-row">
            <div>
              <div className="setting-row-label">Голос</div>
              <div className="setting-row-value">
                {voicesError
                  ? voicesError
                  : voicesLoading
                    ? "Загружаю…"
                    : voices.find((v) => v.id === selectedVoice)?.hint ?? "Мужские голоса"}
              </div>
            </div>
            <select
              className="lang-select"
              value={selectedVoice}
              disabled={voicesLoading || voices.length === 0}
              onChange={(e) => void setVoice(e.target.value)}
            >
              {voices.length === 0 && <option value="">—</option>}
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name}</option>
              ))}
            </select>
          </div>
        )}

        {supportsVoiceChoice(activeProvider) && voices.length > 0 && (
          <div className="setting-row">
            <div>
              <div className="setting-row-label">Пример</div>
              <div className="setting-row-value">
                {sampleError ?? (samplePlaying ? "Звучит…" : getVoiceSample(profile.targetLanguage))}
              </div>
            </div>
            <button
              type="button"
              className="voice-sample-btn"
              disabled={samplePlaying}
              onClick={() => void playSample()}
            >
              {samplePlaying ? "…" : "▶ Послушать"}
            </button>
          </div>
        )}
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
