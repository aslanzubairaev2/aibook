"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Flame, Headphones, Languages, Library, Phone } from "lucide-react";
import { AudiobookDetailModal } from "@/components/discover/AudiobookDetailModal";
import type { Audiobook, Book, Flashcard, UserProfile } from "@/lib/types";
import { useAuth } from "@/lib/auth/useAuth";
import { getCardVariantProgressMap, getLocalNounsDict, getLocalVerbsDict } from "@/lib/db/local";
import { computeHomeStats, mergeDictionaries } from "@/lib/home/homeStats";
import { GENDER_ARTICLE, GENDER_ORDER, type NounGender } from "@/lib/nounForms";
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
 * Главная — то, чем занимаются каждый день, а не витрина.
 *
 * Раньше здесь стояли полки Gutendex: две сетки книг, которые тянулись из
 * внешнего каталога при каждом открытии приложения и до прихода которых экран
 * состоял из серых прямоугольников. Владелец эти книги не читает, так что
 * витрина ушла в «Каталог» целиком, а её место заняло то, ради чего сюда и
 * заходят: повторение и три тренажёра над собственным словарём.
 *
 * Всё, что здесь показано, считается из локальных данных — карточки приходят
 * из зеркала при запуске, словарь из кэшей «Глаголов» и «Существительных».
 * Поэтому страница появляется заполненной сразу и работает офлайн.
 */
export function HomeDashboard({
  book, profile, cards,
  onContinueReading, onOpenCards, onOpenVerbs, onOpenNouns, onOpenDictionary,
  onOpenBooks, onOpenLiveChat, onOpenLiveTranslate,
}: Props) {
  const { user } = useAuth();

  // Словарь читается один раз при монтировании: это подсказка о размере
  // материала, а не живая величина, ради которой стоит ходить в сеть.
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
  const { deck, words, verbs, nouns } = stats;

  return (
    <section className="screen home-screen">
      <header className="home-bar">
        <div className="home-bar-text">
          <h1 className="home-wordmark">AIBook</h1>
          <p className="home-pulse">
            {deck.streak > 0 ? <><b>{deck.streak}</b> {dayWord(deck.streak)} подряд</> : "Начните серию сегодня"}
            {deck.reviewedToday > 0 && <> · сегодня повторено <b>{deck.reviewedToday}</b></>}
          </p>
        </div>
        <div className="home-bar-actions">
          <button className="icon-btn" onClick={onOpenLiveChat} type="button" aria-label="Голосовой чат с AI">
            <Phone size={18} />
          </button>
          <button className="icon-btn" onClick={onOpenBooks} type="button" aria-label="Библиотека">
            <Library size={18} />
          </button>
        </div>
      </header>

      {!user && (
        <p className="home-guest-note">
          Вы вошли как гость — прогресс хранится только в этом браузере.
        </p>
      )}

      {/* Единственный крупный акцент на странице. Всё остальное — строки. */}
      <button
        className={`home-today${words.due > 0 ? " is-due" : ""}`}
        type="button"
        onClick={onOpenCards}
        disabled={words.total === 0}
      >
        <span className="home-today-label">
          <Flame size={13} /> {words.due > 0 ? "К повторению сегодня" : "На сегодня всё"}
        </span>
        <span className="home-today-count">
          {words.total === 0 ? "—" : words.due > 0 ? words.due : "✓"}
        </span>
        {words.total > 0 && (
          <span className="home-today-meter" aria-hidden>
            <i style={{ width: `${percent(words.learned, words.total)}%` }} />
          </span>
        )}
        <span className="home-today-sub">
          {words.total === 0
            ? "Сфотографируйте страницу словаря, чтобы начать"
            : `в памяти ${words.learned} из ${words.total}${words.fresh > 0 ? ` · ${words.fresh} новых` : ""}`}
        </span>
      </button>

      <HomeSection title="Продолжить изучать">
        <HomeRow
          title="Слова"
          detail={words.total > 0 ? `${words.total} карточек · ${words.learned} в памяти` : "Пока пусто"}
          badge={words.due > 0 ? String(words.due) : undefined}
          onClick={onOpenCards}
        />
        <HomeRow
          title="Глаголы"
          detail={
            verbs.total > 0
              ? `${verbs.total} · неправильных ${verbs.irregular}`
              : "Infinitiv · Präteritum · Partizip II"
          }
          hint={verbs.missingForms > 0 ? `${verbs.missingForms} без форм` : undefined}
          onClick={onOpenVerbs}
        />
        <HomeRow
          title="Существительные"
          detail={
            nouns.total > 0
              ? `${nouns.total} · с артиклем ${nouns.withArticle}`
              : "der · die · das и множественное число"
          }
          hint={nouns.withoutArticle > 0 ? `${nouns.withoutArticle} без артикля` : undefined}
          onClick={onOpenNouns}
        />
        <HomeRow title="Мой словарь" detail="Все слова и пачки" onClick={onOpenDictionary} />
      </HomeSection>

      {/* Артикли показываются только когда есть что показывать: три слова —
          это не распределение, а три слова. */}
      {nouns.withArticle >= 6 && (
        <HomeSection title="Артикли в вашем словаре">
          <div className="home-genders">
            {GENDER_ORDER.filter((g) => g !== "pl").map((gender) => (
              <GenderBar
                key={gender}
                gender={gender}
                count={nouns.byGender[gender]}
                total={nouns.withArticle}
                weakest={nouns.weakestGender === gender}
              />
            ))}
          </div>
          {nouns.weakestGender && (
            <p className="home-note">
              Меньше всего слов на <b>{GENDER_ARTICLE[nouns.weakestGender]}</b> — эта группа
              узнаётся хуже просто потому, что встречается реже.
            </p>
          )}
        </HomeSection>
      )}

      <HomeSection title="Ещё">
        <HomeRow
          title="Live перевод"
          detail="Русский перевод почти без задержки"
          icon={<Languages size={16} />}
          onClick={onOpenLiveTranslate}
        />
        {listeningAudiobook && continueListening && (
          <HomeRow
            title={listeningAudiobook.title}
            detail={`${continueListening.chapterTitle || `Глава ${continueListening.chapterIndex + 1}`} · ${formatAudioDuration(continueListening.currentTimeSeconds)}`}
            icon={<Headphones size={16} />}
            onClick={() => setOpenAudiobook(listeningAudiobook)}
          />
        )}
        {/* Полок с книгами здесь больше нет, но начатая книга — это не витрина,
            а закладка: бросать читателя посреди главы незачем. */}
        {book && book.progress > 0 && (
          <HomeRow
            title={book.title}
            detail={`${book.chapterTitle} · ${Math.round(book.progress)}%`}
            onClick={onContinueReading}
          />
        )}
      </HomeSection>

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

/** Заголовок раздела — прописными и мелким, разделитель, а не рамка. */
function HomeSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="home-section">
      <h2 className="home-section-title">{title}</h2>
      <div className="home-rows">{children}</div>
    </section>
  );
}

/**
 * Строка списка.
 *
 * Намеренно не карточка: у неё нет ни фона, ни рамки, ни собственной тени —
 * только волосяная линия снизу. Десять таких строк читаются как список, а
 * десять «плашек» — как десять одинаковых прямоугольников.
 */
function HomeRow({
  title, detail, hint, badge, icon, onClick,
}: {
  title: string;
  detail: string;
  hint?: string;
  badge?: string;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="home-row" type="button" onClick={onClick}>
      {icon && <span className="home-row-icon">{icon}</span>}
      <span className="home-row-text">
        <strong>{title}</strong>
        <small>
          {detail}
          {hint && <em className="home-row-hint"> · {hint}</em>}
        </small>
      </span>
      {badge && <span className="home-row-badge">{badge}</span>}
      <ChevronRight size={15} className="home-row-arrow" />
    </button>
  );
}

function GenderBar({
  gender, count, total, weakest,
}: { gender: NounGender; count: number; total: number; weakest: boolean }) {
  return (
    <div className={`home-gender${weakest ? " is-weakest" : ""}`}>
      <span className={`home-gender-art gender-${gender}`}>{GENDER_ARTICLE[gender]}</span>
      <span className="home-gender-track" aria-hidden>
        <i className={`gender-fill-${gender}`} style={{ width: `${percent(count, total)}%` }} />
      </span>
      <span className="home-gender-count">{count}</span>
    </div>
  );
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
}
