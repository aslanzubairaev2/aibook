"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Headphones, Languages, Library, Mic, Play } from "lucide-react";
import { AudiobookDetailModal } from "@/components/discover/AudiobookDetailModal";
import type { Audiobook, Book, Flashcard, UserProfile } from "@/lib/types";
import { useAuth } from "@/lib/auth/useAuth";
import { getCardVariantProgressMap, getLocalNounsDict, getLocalVerbsDict } from "@/lib/db/local";
import { computeHomeStats, mergeDictionaries } from "@/lib/home/homeStats";
import { splitCardBack } from "@/lib/cards";
import { conjugateGerman } from "@/lib/grammar/germanVerbs";
import { GENDER_ARTICLE, type NounGender } from "@/lib/nounForms";
import { formatAudioDuration, getLastPlayedAudiobook } from "@/lib/audio/audiobooks";

type Props = {
  book: Book | null;
  profile: UserProfile;
  cards: Flashcard[];
  onContinueReading: () => void;
  onOpenCards: () => void;
  onOpenVerbs: () => void;
  onOpenNouns: () => void;
  onOpenDictionary: () => void;
  onOpenBooks: () => void;
  onOpenLiveChat: () => void;
  onOpenLiveTranslate: () => void;
};

/**
 * Главная.
 *
 * Ведущая идея: на этом экране приложение показывает не статистику про немецкий,
 * а сам немецкий. Наверху стоит слово, с которого начнётся сегодняшнее
 * повторение, со своими формами — то же самое, что учащийся увидит первым в
 * тренажёре. «60 карточек» — это отчёт; «sprechen · sprach · gesprochen» —
 * это работа.
 *
 * Формы под словом считает локальный морфологический движок
 * (`lib/grammar/germanVerbs`), поэтому они появляются мгновенно и не стоят ни
 * одного запроса. Набрано слово тем же шрифтом (Lora), которым набран текст в
 * читалке: на главной оно звучит тем же голосом, что и в книге.
 *
 * Всё остальное считается из локальных кэшей — страница не ходит в сеть вовсе
 * и работает офлайн.
 */
export function HomeDashboard({
  book, profile, cards,
  onContinueReading, onOpenCards, onOpenVerbs, onOpenNouns, onOpenDictionary,
  onOpenBooks, onOpenLiveChat, onOpenLiveTranslate,
}: Props) {
  const { user } = useAuth();

  const entries = useState(() =>
    mergeDictionaries(
      getLocalVerbsDict(profile.targetLanguage)?.entries ?? [],
      getLocalNounsDict(profile.targetLanguage)?.entries ?? [],
    ),
  )[0];

  // Граница «сегодня» двигается вместе с сутками — иначе счётчик, оставленный
  // открытым через полночь, продолжает показывать вчерашнее число.
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      setToday((prev) => (prev.getDate() === new Date().getDate() ? prev : new Date()));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(
    () => computeHomeStats(cards, getCardVariantProgressMap(), entries, today),
    [cards, entries, today],
  );

  const [continueListening, setContinueListening] = useState<ReturnType<typeof getLastPlayedAudiobook>>(null);
  useEffect(() => { setContinueListening(getLastPlayedAudiobook()); }, []);

  const listeningAudiobook = useMemo<Audiobook | null>(() => {
    if (!continueListening) return null;
    return {
      id: continueListening.audiobookId,
      title: continueListening.title || "Аудиокнига",
      author: continueListening.author || "Неизвестный автор",
      language: continueListening.language || profile.targetLanguage,
      cefrLevel: continueListening.cefrLevel ?? null,
      cefrConfidence: continueListening.cefrConfidence,
      coverUrl: continueListening.coverUrl ?? null,
      coverColor: continueListening.coverColor,
      sourceType: "librivox",
    };
  }, [continueListening, profile.targetLanguage]);

  const [openAudiobook, setOpenAudiobook] = useState<Audiobook | null>(null);
  const { deck, nextUp, words, verbs, nouns } = stats;

  return (
    <section className="screen home">
      <header className="home-bar">
        <div>
          <h1 className="home-wordmark">AIBook</h1>
          <p className="home-pulse">
            {deck.streak > 0 ? <><b>{deck.streak}</b> {dayWord(deck.streak)} подряд</> : "Начните серию сегодня"}
            {deck.reviewedToday > 0 && <> · сегодня <b>{deck.reviewedToday}</b></>}
          </p>
        </div>
        <button className="icon-btn" onClick={onOpenBooks} type="button" aria-label="Библиотека">
          <Library size={18} />
        </button>
      </header>

      {!user && (
        <p className="home-guest">Вы вошли как гость — прогресс хранится только в этом браузере.</p>
      )}

      <FocusWord card={nextUp} due={words.due} total={words.total} language={profile.targetLanguage} />

      {/* Две вещи, которые делают каждый день: повторить и поговорить.
          Голосовой режим стоит здесь, а не иконкой в углу — говорение это
          половина изучения языка, а не служебная функция. */}
      <div className="home-actions">
        <button className="home-act home-act--primary" type="button" onClick={onOpenCards} disabled={words.total === 0}>
          <Play size={17} fill="currentColor" />
          <span>{words.due > 0 ? `Повторить ${words.due}` : "Повторение"}</span>
        </button>
        <button className="home-act home-act--voice" type="button" onClick={onOpenLiveChat}>
          <Mic size={17} />
          <span>Поговорить</span>
        </button>
      </div>

      {/* Триада тренажёров. Три — собственный ритм немецкой грамматики:
          три артикля, три основные формы глагола. */}
      <div className="home-triad">
        <DrillTile tone="words" title="Слова" value={words.total} note={`${words.learned} в памяти`} onClick={onOpenCards} />
        <DrillTile
          tone="verbs"
          title="Глаголы"
          value={verbs.total}
          note={verbs.missingForms > 0 ? `${verbs.missingForms} без форм` : `${verbs.irregular} неправильных`}
          alert={verbs.missingForms > 0}
          onClick={onOpenVerbs}
        />
        <DrillTile
          tone="nouns"
          title="Артикли"
          value={nouns.total}
          note={nouns.withoutArticle > 0 ? `${nouns.withoutArticle} без артикля` : `${nouns.withArticle} с артиклем`}
          alert={nouns.withoutArticle > 0}
          onClick={onOpenNouns}
        />
      </div>

      {/* Показывается только когда есть что показывать: три слова — это не
          распределение, а три слова. */}
      {nouns.withArticle >= 6 && (
        <ArticleSplit byGender={nouns.byGender} total={nouns.withArticle} weakest={nouns.weakestGender} />
      )}

      <div className="home-more">
        <MoreRow icon={<Languages size={15} />} title="Live перевод" note="Русский почти без задержки" onClick={onOpenLiveTranslate} />
        {listeningAudiobook && continueListening && (
          <MoreRow
            icon={<Headphones size={15} />}
            title={listeningAudiobook.title}
            note={`${continueListening.chapterTitle || `Глава ${continueListening.chapterIndex + 1}`} · ${formatAudioDuration(continueListening.currentTimeSeconds)}`}
            onClick={() => setOpenAudiobook(listeningAudiobook)}
          />
        )}
        {/* Полок с книгами здесь нет, но начатая книга — не витрина, а
            закладка: бросать читателя посреди главы незачем. */}
        {book && book.progress > 0 && (
          <MoreRow title={book.title} note={`${book.chapterTitle} · ${Math.round(book.progress)}%`} onClick={onContinueReading} />
        )}
        <MoreRow title="Мой словарь" note="Все слова и пачки" onClick={onOpenDictionary} />
      </div>

      {openAudiobook && (
        <AudiobookDetailModal
          audiobook={openAudiobook}
          nativeLanguage={profile.nativeLanguage}
          onClose={() => {
            setOpenAudiobook(null);
            setContinueListening(getLastPlayedAudiobook());
          }}
        />
      )}
    </section>
  );
}

/**
 * Слово, с которого начнётся сегодняшнее повторение.
 *
 * Формы под ним — не украшение: это ровно то, что спросят. Для глагола
 * показываются Präteritum и Partizip II, для остального — перевод.
 */
function FocusWord({
  card, due, total, language,
}: { card: Flashcard | null; due: number; total: number; language: string }) {
  if (total === 0) {
    return (
      <div className="focus focus--empty">
        <p className="focus-eyebrow">Пока пусто</p>
        <p className="focus-invite">Сфотографируйте страницу словаря — приложение разберёт её на слова.</p>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="focus focus--done">
        <p className="focus-eyebrow">На сегодня всё</p>
        <p className="focus-invite">Повторения закончились. Возвращайтесь завтра или добавьте новые слова.</p>
      </div>
    );
  }

  const headword = card.front.trim();
  const forms = language === "de" ? conjugateGerman(headword.replace(/^(der|die|das)\s+/i, "")) : null;
  const meaning = splitCardBack(card.back).meaning;

  return (
    <div className="focus">
      <p className="focus-eyebrow">
        Сегодня · {due} {cardWord(due)}
      </p>
      <p className="focus-word">{headword}</p>
      {/* Непроверенные формы не показываются — тот же принцип, что и во
          всплывающей подсказке: лучше ничего, чем «gehte». */}
      {forms && !forms.provisional && (
        <p className="focus-forms">
          {forms.praeteritum} · {forms.hilfsverb === "sein" ? "ist" : "hat"} {forms.partizip2}
        </p>
      )}
      {meaning && <p className="focus-meaning">{meaning}</p>}
    </div>
  );
}

/** Плитка тренажёра: крупное число, свой цвет, одна строка пояснения. */
function DrillTile({
  tone, title, value, note, alert, onClick,
}: { tone: string; title: string; value: number; note: string; alert?: boolean; onClick: () => void }) {
  return (
    <button className={`tile tile--${tone}`} type="button" onClick={onClick}>
      <span className="tile-title">{title}</span>
      <span className="tile-value">{value}</span>
      <span className={`tile-note${alert ? " is-alert" : ""}`}>{note}</span>
    </button>
  );
}

/**
 * der / die / das одной полосой.
 *
 * Три артикля — самое узнаваемое, что есть в немецком, и в приложении у них уже
 * есть закреплённые цвета. Одна составная полоса читается как соотношение,
 * тогда как три отдельные — как таблица.
 */
function ArticleSplit({
  byGender, total, weakest,
}: { byGender: Record<NounGender, number>; total: number; weakest: NounGender | null }) {
  const parts: NounGender[] = ["m", "f", "n"];

  return (
    <section className="split">
      <div className="split-bar" role="img" aria-label={`Существительных: der ${byGender.m}, die ${byGender.f}, das ${byGender.n}`}>
        {parts.map((g) => (
          <i key={g} className={`split-seg split-seg--${g}`} style={{ flexGrow: byGender[g] || 0.001 }} />
        ))}
      </div>
      <div className="split-legend">
        {parts.map((g) => (
          <span key={g} className={`split-key${weakest === g ? " is-weakest" : ""}`}>
            <i className={`split-dot split-seg--${g}`} />
            {GENDER_ARTICLE[g]} <b>{byGender[g]}</b>
          </span>
        ))}
      </div>
      {weakest && (
        <p className="split-note">
          Слов на <b>{GENDER_ARTICLE[weakest]}</b> меньше всего — эта группа узнаётся хуже
          просто потому, что реже попадается.
        </p>
      )}
    </section>
  );
}

function MoreRow({
  icon, title, note, onClick,
}: { icon?: React.ReactNode; title: string; note: string; onClick: () => void }) {
  return (
    <button className="more-row" type="button" onClick={onClick}>
      {icon && <span className="more-row-icon">{icon}</span>}
      <span className="more-row-text">
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
      <ChevronRight size={15} className="more-row-arrow" />
    </button>
  );
}

function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
}

function cardWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "карточек";
  if (mod10 === 1) return "карточка";
  if (mod10 >= 2 && mod10 <= 4) return "карточки";
  return "карточек";
}
