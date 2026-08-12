"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera, Check, ImageUp, Loader2, RotateCw, X, Repeat,
} from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { PhotoCropper, type CropperHandle } from "./PhotoCropper";
import { DictateButton, appendSpoken } from "@/components/discover/DictateButton";

type Stage = "camera" | "crop" | "reading" | "language" | "building" | "failed";

type Props = {
  targetLanguage: string;
  nativeLanguage: string;
  /**
   * "lesson" turns the photo into a reading text; "dictionary" turns it into
   * word entries. Same camera and cropper, different destination — and in the
   * dictionary case there is no lesson to open afterwards.
   */
  mode?: "lesson" | "dictionary";
  /** Called with the new lesson id once it is saved. */
  /** `warning` is set when the lesson was saved in a degraded form (raw transcription, or text that may be cut short). */
  onCreated: (lessonId: string, warning?: string) => void;
  /** Dictionary mode: how many words were added, and any warning about the page. */
  onWordsAdded?: (summary: { added: number; updated: number; total: number; warning?: string }) => void;
  onClose: () => void;
  /** Auth headers for the API calls; the parent owns the session. */
  authHeaders: () => Promise<Record<string, string>>;
};

type Extracted = { language: string; languages?: string[]; isStudyMaterial?: boolean; text: string; kind: string };

const MAX_UPLOAD_SIZE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * `fetch` rejects with a bare "Failed to fetch" for anything that never got a
 * reply — a dropped connection, or the platform killing a function that ran
 * past its limit. Neither tells the learner what to do about it.
 */
function describeNetworkFailure(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Сервер не ответил. Возможно, снимок слишком крупный или пропала связь — обрежьте кадр плотнее и попробуйте ещё раз.";
  }
  return message || fallback;
}

function languageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.nameNative ?? code.toUpperCase();
}

/**
 * Photograph a real document and get it into the reader.
 *
 * The text is reproduced as it is — restored, or translated faithfully — not
 * graded down to the learner's level. These are contracts, letters and labels
 * from daily life, and their difficulty is the point.
 *
 * Fullscreen throughout: framing a page and cropping it accurately needs the
 * whole viewport, and this is a phone-first flow.
 */
export function PhotoLessonModal({
  targetLanguage, nativeLanguage, mode = "lesson", onCreated, onWordsAdded, onClose, authHeaders,
}: Props) {
  const toDictionary = mode === "dictionary";
  const [stage, setStage] = useState<Stage>("camera");
  // Kept so a failed rewrite can be retried without paying to read the photo again.
  const [retry, setRetry] = useState<{ source: Extracted; language: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  // Free-text instruction: "just list these words", "write a text using them",
  // "make it about the kitchen". Sent with the photo and outranks the defaults.
  const [note, setNote] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cropperRef = useRef<CropperHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  // Start the rear camera on entry. Failure is not fatal — the file picker
  // below covers desktops, denied permissions and browsers without getUserMedia.
  useEffect(() => {
    if (stage !== "camera") return;
    let cancelled = false;

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Камера недоступна — нажмите значок слева, чтобы выбрать фото из галереи.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => { /* autoplay guard */ });
        }
        setCameraReady(true);
        setError(null);
      } catch {
        if (!cancelled) setError("Нет доступа к камере — нажмите значок слева, чтобы выбрать фото из галереи.");
      }
    })();

    return () => { cancelled = true; };
  }, [stage]);

  useEffect(() => stopCamera, [stopCamera]);

  const shoot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setPhoto(canvas.toDataURL("image/jpeg", 0.95));
    stopCamera();
    setStage("crop");
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result));
      stopCamera();
      setStage("crop");
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const retake = () => {
    setPhoto(null);
    setExtracted(null);
    setRetry(null);
    setError(null);
    setStage("camera");
  };

  /**
   * Dictionary mode: one call, straight from the picture to word entries.
   *
   * Not routed through the transcription step the lesson flow uses — a word
   * list is a layout, and the model reads "der Ball, ¨e" out of the picture far
   * more reliably than out of a flattened transcription of it.
   */
  const readWords = async (cropped: string) => {
    setStage("reading");
    setError(null);
    try {
      const res = await fetch("/api/dictionary/from-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ image: cropped, targetLanguage, nativeLanguage, note: note.trim() }),
      });
      const data = await res.json() as {
        added?: number; updated?: number; total?: number; warning?: string; error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Ошибка распознавания (${res.status})`);
      onWordsAdded?.({
        added: data.added ?? 0,
        updated: data.updated ?? 0,
        total: data.total ?? 0,
        warning: data.warning,
      });
    } catch (err) {
      setError(describeNetworkFailure(err, "Не удалось разобрать слова."));
      setStage("crop");
    }
  };

  /** Step 1: send the cropped region and get back what it says. */
  const readPhoto = async () => {
    const cropped = cropperRef.current?.exportCropped(MAX_UPLOAD_SIZE, JPEG_QUALITY);
    if (!cropped) {
      setError("Не удалось подготовить снимок. Попробуйте ещё раз.");
      return;
    }

    if (toDictionary) {
      await readWords(cropped);
      return;
    }

    setStage("reading");
    setError(null);
    try {
      const res = await fetch("/api/lessons/from-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ image: cropped }),
      });
      const data = await res.json() as Extracted & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Ошибка распознавания (${res.status})`);

      setExtracted(data);
      // Teaching material is always worked in the language being learned — the
      // page is mostly explanations in the learner's own language, but the
      // material is the foreign words, so there is nothing to ask.
      const alreadyTarget = data.language === targetLanguage;
      const teaches = data.isStudyMaterial && (data.languages ?? []).includes(targetLanguage);
      if (alreadyTarget || teaches) {
        await buildLesson(data, targetLanguage);
      } else {
        setStage("language");
      }
    } catch (err) {
      setError(describeNetworkFailure(err, "Не удалось прочитать снимок."));
      setStage("crop");
    }
  };

  /** Step 2: build and save the lesson from the transcription. */
  const buildLesson = async (source: Extracted, chosenLanguage: string) => {
    setStage("building");
    setError(null);
    try {
      const res = await fetch("/api/lessons/from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          sourceText: source.text,
          sourceLanguage: source.language,
          sourceKind: source.kind,
          targetLanguage: chosenLanguage,
          nativeLanguage,
          note: note.trim(),
          isStudyMaterial: source.isStudyMaterial === true,
        }),
      });
      const data = await res.json() as { id?: string; error?: string; warning?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? `Ошибка создания урока (${res.status})`);
      onCreated(data.id, data.warning);
    } catch (err) {
      setError(describeNetworkFailure(err, "Не удалось составить текст."));
      // Back to a screen that can retry from the transcription already in
      // hand: re-reading the photo costs another model call and gains nothing,
      // since the text was read correctly — it was the rewrite that failed.
      setRetry({ source, language: chosenLanguage });
      setStage("failed");
    }
  };

  const busy = stage === "reading" || stage === "building";

  return (
    <div className="photo-modal">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <header className="photo-bar">
        <button type="button" className="photo-icon-btn" onClick={onClose} aria-label="Закрыть" disabled={busy}>
          <X size={22} />
        </button>
        <span className="photo-bar-title">
          {stage === "camera" && (toDictionary ? "Сфотографируйте слова" : "Сфотографируйте текст")}
          {stage === "crop" && "Выделите нужный участок"}
          {stage === "reading" && "Читаю снимок..."}
          {stage === "language" && "Язык перевода"}
          {stage === "building" && "Перевожу текст..."}
          {stage === "failed" && "Не получилось"}
        </span>
        {stage === "crop" ? (
          <button type="button" className="photo-icon-btn" onClick={retake} aria-label="Переснять">
            <Repeat size={20} />
          </button>
        ) : <span className="photo-icon-btn" aria-hidden />}
      </header>

      <div className="photo-stage">
        {stage === "camera" && (
          <>
            <video ref={videoRef} className="photo-video" playsInline muted autoPlay />
            {!cameraReady && (
              <div className="photo-hint">
                {error ?? "Запрашиваю камеру..."}
              </div>
            )}
          </>
        )}

        {(stage === "crop" || busy) && photo && (
          <PhotoCropper ref={cropperRef} src={photo} disabled={busy} />
        )}

        {stage === "crop" && (
          <div className="photo-note">
            <div className="lesson-input-row">
              <input
                type="text"
                placeholder={toDictionary
                  ? "Примечание для ИИ — например: только существительные"
                  : "Что сделать с этим? Например: просто список слов"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={800}
              />
              <DictateButton
                lang={nativeLanguage}
                title="Наговорить указание"
                onText={(t) => setNote((prev) => appendSpoken(prev, t))}
              />
            </div>
          </div>
        )}

        {stage === "language" && extracted && (
          <div className="photo-sheet">
            <h3>Текст на снимке — {languageName(extracted.language)}</h3>
            <p>
              {extracted.kind ? `Похоже на: ${extracted.kind}. ` : ""}
              На какой язык перевести? Перевод точный, без упрощения — текст останется таким же по сложности.
            </p>
            <div className="photo-excerpt">{extracted.text.slice(0, 300)}{extracted.text.length > 300 ? "…" : ""}</div>
            <div className="photo-lang-list">
              {SUPPORTED_LANGUAGES.filter((l) => l.code !== nativeLanguage).map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  className={`photo-lang-btn${lang.code === targetLanguage ? " primary" : ""}`}
                  onClick={() => void buildLesson(extracted, lang.code)}
                >
                  {lang.nameNative}
                  {lang.code === targetLanguage && <span>вы учите</span>}
                </button>
              ))}
            </div>
            <button type="button" className="photo-cancel" onClick={onClose}>Отменить</button>
          </div>
        )}

        {stage === "failed" && retry && (
          <div className="photo-sheet">
            <h3>Текст со снимка прочитан, но урок не собрался</h3>
            <p>
              Снимок повторно отправлять не нужно — попробуем собрать урок ещё раз из того же
              распознанного текста.
            </p>
            <div className="photo-excerpt">{retry.source.text.slice(0, 300)}{retry.source.text.length > 300 ? "…" : ""}</div>
            <div className="photo-lang-list">
              <button
                type="button"
                className="photo-lang-btn primary"
                onClick={() => void buildLesson(retry.source, retry.language)}
              >
                Попробовать ещё раз
              </button>
              <button type="button" className="photo-lang-btn" onClick={retake}>
                Снять заново
              </button>
            </div>
            <button type="button" className="photo-cancel" onClick={onClose}>Отменить</button>
          </div>
        )}

        {busy && (
          <div className="photo-overlay">
            <Loader2 className="spin" size={34} />
            <span>
              {stage === "reading"
                ? (toDictionary ? "Собираю слова со снимка..." : "Разбираю текст на снимке...")
                : "Готовлю текст..."}
            </span>
          </div>
        )}
      </div>

      {error && stage !== "camera" && <div className="photo-error">{error}</div>}

      <footer className="photo-actions">
        {stage === "camera" && (
          <>
            <button
              type="button"
              className="photo-gallery-btn"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Выбрать фото из галереи"
              title="Выбрать фото из галереи"
            >
              <ImageUp size={22} />
            </button>
            <button
              type="button"
              className="photo-shutter"
              onClick={shoot}
              disabled={!cameraReady}
              aria-label="Снять"
            >
              <Camera size={26} />
            </button>
            <span className="photo-gallery-btn" aria-hidden />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              // Deliberately no `capture` attribute: it forces Android straight
              // into the camera app, which is what this button is an
              // alternative to. Without it the picker offers the gallery,
              // files, and the camera as one of the choices.
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </>
        )}

        {stage === "crop" && (
          <>
            <button type="button" className="photo-tool" onClick={() => cropperRef.current?.rotate()}>
              <RotateCw size={18} />Повернуть
            </button>
            <button type="button" className="photo-tool" onClick={() => cropperRef.current?.reset()}>
              Весь кадр
            </button>
            <button type="button" className="photo-confirm" onClick={() => void readPhoto()}>
              <Check size={18} />Готово
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

const STYLES = `
  .photo-modal {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    flex-direction: column;
    background: #0b0a09;
    color: var(--text-primary);
  }
  .photo-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    padding-top: max(10px, env(safe-area-inset-top));
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .photo-bar-title { flex: 1; text-align: center; font-size: 14px; font-weight: 700; }
  .photo-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
  }
  .photo-icon-btn:disabled { opacity: 0.4; }

  .photo-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
  .photo-video { width: 100%; height: 100%; object-fit: cover; background: #000; }
  .photo-hint {
    position: absolute;
    inset: auto 16px 16px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(0,0,0,0.66);
    font-size: 13px;
    text-align: center;
  }

  .photo-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(11,10,9,0.82);
    font-size: 14px;
  }

  .photo-error {
    margin: 0 12px 8px;
    padding: 9px 11px;
    border: 1px solid rgba(196,106,106,0.45);
    border-radius: 9px;
    background: rgba(196,106,106,0.12);
    color: #e2a0a0;
    font-size: 12.5px;
  }

  .photo-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 14px 16px;
    padding-bottom: max(14px, env(safe-area-inset-bottom));
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  .photo-shutter {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 68px;
    height: 68px;
    border: 4px solid rgba(255,255,255,0.85);
    border-radius: 50%;
    background: var(--accent);
    color: var(--text-dark);
  }
  .photo-shutter:disabled { opacity: 0.4; }
  .photo-shutter:active:not(:disabled) { transform: scale(0.94); }
  .photo-gallery-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
  }
  .photo-tool, .photo-confirm {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 42px;
    padding: 0 16px;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 12px;
    background: transparent;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .photo-confirm { border-color: transparent; background: var(--accent); color: var(--text-dark); }

  .photo-note {
    position: absolute;
    inset: auto 10px 10px;
    padding: 8px;
    border-radius: 12px;
    background: rgba(11,10,9,0.82);
    backdrop-filter: blur(8px);
  }
  .photo-note input {
    width: 100%;
    height: 38px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: rgba(0,0,0,0.35);
    color: var(--text-primary);
    font-size: 13.5px;
  }

  .photo-sheet {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 20px 18px 24px;
    background: var(--bg-secondary);
  }
  .photo-sheet h3 { font-size: 17px; margin-bottom: 6px; }
  .photo-sheet > p { font-size: 13.5px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px; }
  .photo-excerpt {
    max-height: 30vh;
    overflow-y: auto;
    padding: 10px 12px;
    margin-bottom: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgba(240,230,211,0.04);
    color: var(--text-muted);
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .photo-lang-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .photo-lang-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 46px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: transparent;
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 600;
  }
  .photo-lang-btn.primary { border-color: var(--accent); background: rgba(212,168,71,0.12); color: var(--accent); }
  .photo-lang-btn span { font-size: 11px; font-weight: 700; text-transform: uppercase; opacity: 0.75; }
  .photo-cancel {
    width: 100%;
    height: 42px;
    border: 0;
    border-radius: 11px;
    background: rgba(240,230,211,0.06);
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 600;
  }
`;
