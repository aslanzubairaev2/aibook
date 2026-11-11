"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ArrowLeft, Search, Trash2, Flame, CheckCircle2, RotateCcw, AlertCircle, Play, Layers, ChevronDown, ChevronLeft, ChevronRight, MessageCircle, SlidersHorizontal, Volume2, FileText, Loader2, Eye, X, BarChart3, Maximize2, Minimize2, Keyboard, EyeOff, ShieldCheck } from "lucide-react";
import { CEFR_LEVELS, LEARNING_ITEM_TYPES, type AiAnalysis, type CardFilters, type CefrLevel, type DiscussMessage, type Flashcard, type ReverseWordAnalysis, type TrainVariant, type TtsProvider } from "@/lib/types";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { isLeech, recallChance, reviewMemory, type ReviewGrade } from "@/lib/srs/fsrs";
import { ALL_TRAIN_VARIANTS, buildTrainQueue, heldBackNewCards, NEW_PER_DAY_OPTIONS, computeDeckStats, countTrainCandidates, endOfTodayMs, listCardSources, matchesCefrFilter, type CardSource, describePackTraining, normalizePackTraining, filterCardsByTrainingSource, findDuplicateCard, getReviewHistoryPosition, getVariantProgress, resolveCardFilters, shuffleTrainQueue, splitCardBack, relearnAfterGrade, todaysDirection, DEFAULT_TRAIN_VARIANTS, type ResolvedCardFilters, type TrainBatch, type TrainQueueItem, type TrainStatus, type VariantProgress, type VariantProgressMap } from "@/lib/cards";
import { isTypingTarget, trainerHotkey } from "@/lib/srs/trainerHotkeys";
import { normalizePos } from "@/lib/verbForms";
import { TrainerKeysModal } from "@/components/cards/TrainerKeysModal";
import { SourcePickerModal } from "@/components/cards/SourcePickerModal";
import { normalizeToken } from "@/lib/selector/text";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { getTTSState, prefetchSpeechAhead, respeak, speak, stopTTS, subscribeTTS, toggleRepeat } from "@/lib/tts";
import { RespeakButton } from "@/components/ui/RespeakButton";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey, makeDiscussCacheKey, makeWordContextCacheKey } from "@/lib/ai/cacheKeys";
import type { CardVerifyDictionaryEntry } from "@/lib/ai/cardVerify";
import { CardFixModal, type CardFixApplyResult } from "@/components/cards/CardFixModal";
import { getLocalAiAnalysis, saveLocalAiAnalysis, getLocalProfile, saveLocalProfile, getSrsSession, saveSrsSession, clearSrsSession, getLocalDiscussHistory, saveLocalDiscussHistory, getCardSkillProgressMap, getCardVariantProgressMap, saveCardVariantProgress } from "@/lib/db/local";
import { pushCardVariant } from "@/lib/sync/cardOutbox";
import { cardsForWordKeys, strugglingWordKeys } from "@/lib/srs/struggling";
import { getLocalNounsDict, getLocalOtherPosDict, getLocalPackProgress, getLocalVerbsDict } from "@/lib/db/local";
import { sbInsertFlashcard, sbGetDiscussHistory, sbSaveDiscussHistory, sbUpsertSettings, sbAuthHeaders } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import { WordModal } from "@/components/word-modal/WordModal";
import { CardVerbForms, useCardVerbSummary } from "@/components/verbs/VerbPrincipalParts";
import { ReverseWordModal } from "@/components/word-modal/ReverseWordModal";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { describeCardFamiliarity } from "@/lib/ai/wordProfile";
import { ProductiveTrainer } from "@/components/cards/ProductiveTrainer";
import { logTrainingEvent } from "@/lib/training/client";
import { CARDS_STYLES } from "@/components/cards/cardsStyles";
import { normalizeFront, type FilterStatus, type FilterType, type SortOrder, TYPE_LABELS, discussionModeForCard, TRAIN_STATUS_LABELS, TRAIN_VARIANT_LABELS, VARIANT_SHORT_LABELS, STATUS_LABELS, isPlayerShowing, cardNoun, sourceNoun, ttsProvidersFor, TokenizedText, type WordFacts, EMPTY_SKILL_STATE, DueCardRow, AllCardRow, StatsPanel } from "@/components/cards/cardsParts";
import { FilterSheet } from "@/components/ui/FilterSheet";

type Props = {
  cards: Flashcard[];
  /** Which tab to open on — "all" when arriving from «тренировать пачку» in the dictionary. */
  initialTab?: "today" | "train" | "all" | null;
  /**
   * A dictionary batch to train, handed over by «тренировать эту пачку».
   * Session-only: it narrows this visit and is never written over the saved
   * filters, so the learner's own training setup survives it.
   */
  trainBatch?: TrainBatch | null;
  /** Changes when the account's schedules were re-read; the local snapshot is then retaken. */
  progressRevision?: number;
  /** Lets the owner drop its copy of the batch once the session leaves it. */
  onExitBatch?: () => void;
  onBack: () => void;
  /** «Перейти к флешкарте»: show this one card read-only instead of the module. */
  previewCardId?: string | null;
  /** Leaves the preview — back to wherever the learner came from. */
  onClosePreview?: () => void;
  onAddCard: (card: Flashcard) => void;
  onUpdateCard: (card: Flashcard) => void;
  onDeleteCard: (id: string) => void;
  onDeleteCards: (ids: string[]) => void;
  onFindVideos?: (word: string, lang?: string) => void;
};


export function CardsView({ cards, initialTab, trainBatch, progressRevision = 0, onExitBatch, onBack, previewCardId = null, onClosePreview, onAddCard, onUpdateCard, onDeleteCard, onDeleteCards, onFindVideos }: Props) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(getLocalProfile);
  const targetLanguage = profile.targetLanguage;
  const nativeLanguage = profile.nativeLanguage;

  const savedFilters = profile.cardFilters;

  // The batch narrows this visit only. Held here so leaving it is a local
  // change of mind rather than a round trip through the owner.
  const [batch, setBatch] = useState<TrainBatch | null>(trainBatch ?? null);
  // What this pack's own setup does, and why — shown in the banner so a
  // session that ignores the learner's usual filters explains itself.
  const batchTrainingSummary = describePackTraining(batch?.training);
  const batchTrainingNote = normalizePackTraining(batch?.training)?.note ?? "";
  const [initialFilters] = useState<ResolvedCardFilters>(() => resolveCardFilters(savedFilters, trainBatch ?? null));

  const [activeTab, setActiveTab] = useState<"today" | "train" | "all">(initialTab ?? "today");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(initialFilters.filterStatus);
  const [filterType, setFilterType] = useState<FilterType>(initialFilters.filterType);
  const [filterBook, setFilterBook] = useState<string>(initialFilters.filterBook);
  const [excludedLevels, setExcludedLevels] = useState<CefrLevel[]>(initialFilters.filterLevels);
  const [filterPos, setFilterPos] = useState<string>(initialFilters.filterPos);
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialFilters.sortOrder);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showTrainFilterPanel, setShowTrainFilterPanel] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showTtsMenu, setShowTtsMenu] = useState(false);
  const [showKeysModal, setShowKeysModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Whether the audio player is on screen. While it is, two of the keypad's
  // grades drive it instead of the card — see trainerHotkeys.
  // `subscribeTTS` calls the listener once on subscribe, so the state is in
  // step from the first frame without a second read.
  const [playerOpen, setPlayerOpen] = useState(() => isPlayerShowing(getTTSState().status));
  useEffect(() => subscribeTTS((state) => setPlayerOpen(isPlayerShowing(state.status))), []);

  // Training state
  const [currentTrainIndex, setCurrentTrainIndex] = useState(0);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const arrivedForBatch = Boolean(trainBatch);
  const [trainFilter, setTrainFilter] = useState<FilterType>(initialFilters.trainFilter);
  const [trainStatus, setTrainStatus] = useState<TrainStatus>(initialFilters.trainStatus);
  // Narrows a training session to one source — a book, or a dictionary batch
  // («тренировать именно эти слова» from the dictionary lands here).
  const [trainBook, setTrainBook] = useState<string>(initialFilters.trainBook);
  const [trainSourceId, setTrainSourceId] = useState<string | null>(initialFilters.trainSourceId);
  // Sources this learner has told the trainer to leave alone — the book they
  // have finished, the pack they are saving for next week. The opposite end of
  // the same question as trainBook above: one names what to train, this names
  // what to train around.
  const [trainExcluded, setTrainExcluded] = useState<string[]>(initialFilters.trainExcluded);
  // Narrows a training session to one part of speech — «продолжить изучение»
  // from a Словарь pack filtered to существительное lands here too.
  const [trainPos, setTrainPos] = useState<string>(initialFilters.trainPos);
  const [trainVariants, setTrainVariants] = useState<TrainVariant[]>(initialFilters.trainVariants);
  const [trainMode, setTrainMode] = useState<"recognize" | "active">(initialFilters.trainMode);
  // Zen: the trainer with everything around it taken away — no header, no
  // counters, no tabs, no filters. Grading a card is one decision repeated a
  // hundred times, and on a phone the page around the card was tall enough to
  // push the grade buttons under the fold, so every single one of those
  // decisions cost a scroll down and a scroll back up.
  const [zenMode, setZenMode] = useState(initialFilters.zenMode);
  const [newPerDay, setNewPerDay] = useState(initialFilters.newPerDay);
  // Snapshot of the cards being trained this session — built once per session
  // start/filter change rather than re-derived from the (mutating) `cards`
  // prop on every render, so grading a card can't shrink the queue out from
  // under `currentTrainIndex` mid-session.
  const [trainQueue, setTrainQueue] = useState<TrainQueueItem[]>([]);
  // Session-only snapshots of cards that have already been graded. Browsing
  // this list never touches the live queue or any SRS state.
  const [reviewHistory, setReviewHistory] = useState<TrainQueueItem[]>([]);
  const [viewingHistoryIndex, setViewingHistoryIndex] = useState<number | null>(null);
  // This session was started as a drill: everything in scope, whether or not
  // the schedule says it is due. It is how a pack met for the first time gets
  // gone through again and again until the words start to stick — and it is
  // remembered for the session, so «ещё раз» at the end of it means the same
  // thing it meant at the start.
  const [drilling, setDrilling] = useState(false);

  // Per-variant SRS progress, read from storage once and replaced (never
  // mutated) after a grade, so every memo below can key on its identity
  // instead of re-reading storage per card.
  const [variantProgress, setVariantProgress] = useState<VariantProgressMap>(getCardVariantProgressMap);
  // Retaken during render rather than in an effect: the new snapshot is there
  // for the very paint that follows a refresh, not one frame later.
  const [seenRevision, setSeenRevision] = useState(progressRevision);
  if (seenRevision !== progressRevision) {
    setSeenRevision(progressRevision);
    setVariantProgress(getCardVariantProgressMap());
  }
  const skillProgress = useMemo(() => getCardSkillProgressMap(), [cards]);

  // The end of "today" only has to move when the day does.
  const [todayEndTime, setTodayEndTime] = useState(endOfTodayMs);
  useEffect(() => {
    const id = setInterval(() => {
      setTodayEndTime((prev) => {
        const next = endOfTodayMs();
        return next === prev ? prev : next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Discuss-with-AI state (chat about a specific card)
  const [discuss, setDiscuss] = useState<{
    open: boolean;
    card: Flashcard | null;
    cacheKey: string;
    messages: DiscussMessage[];
    historyLoading: boolean;
    /** The schedule of the direction being trained, when opened from a card. */
    progress?: VariantProgress | null;
  }>({ open: false, card: null, cacheKey: "", messages: [], historyLoading: false });

  // The card's own schedule is what tells the tutor whether this word needs a
  // memory hook or nothing but nuance — the schedule of the direction actually
  // being trained, since «verliebt» can be easy to read and a leech to say.
  const discussWordProfile = useMemo(
    () => describeCardFamiliarity(discuss.card && discuss.progress ? { ...discuss.card, ...discuss.progress } : discuss.card),
    [discuss.card, discuss.progress],
  );

  // Word modal state
  const [wordModal, setWordModal] = useState<{
    open: boolean;
    word: string;
    analysis: AiAnalysis | null;
    loading: boolean;
  }>({ open: false, word: "", analysis: null, loading: false });

  // The card being checked by the AI. While set, a blocking modal sits over
  // everything else.
  const [fixCard, setFixCard] = useState<Flashcard | null>(null);

  // The other direction's lookup. A reverse card shows the learner's own
  // language, so a word tapped there is not a word to be explained — it is a
  // word they cannot yet say, and the answer is the target-language form.
  const [reverseWord, setReverseWord] = useState<{
    open: boolean;
    word: string;
    analysis: ReverseWordAnalysis | null;
    loading: boolean;
  }>({ open: false, word: "", analysis: null, loading: false });

  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pagination for "All Cards"
  const [visibleCount, setVisibleCount] = useState(50);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [showStats, setShowStats] = useState(false);

  // --- Stats ---
  // One traversal of the deck, reused by the banner, the badges and the panel.
  // Never-seen words over today's limit. A pack opened from the dictionary is
  // a deliberate choice of exactly those words, so nothing is held back there.
  const heldNew = useMemo(
    () => (batch ? new Set<string>() : heldBackNewCards(cards, newPerDay, new Date(todayEndTime))),
    [batch, cards, newPerDay, todayEndTime],
  );

  // Words that keep being missed in the grammar trainers count as «Сложные»
  // here too — one notion of a hard word, wherever it was drilled.
  const extraHard = useMemo(() => {
    const keys = strugglingWordKeys([
      { entries: getLocalVerbsDict(targetLanguage)?.entries ?? [], progress: getLocalPackProgress("verbs") },
      { entries: getLocalNounsDict(targetLanguage)?.entries ?? [], progress: getLocalPackProgress("nouns") },
      { entries: getLocalOtherPosDict(targetLanguage)?.entries ?? [], progress: getLocalPackProgress("otherpos") },
    ]);
    return cardsForWordKeys(cards, keys);
    // progressRevision: the trainers' progress was refreshed from the account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, targetLanguage, progressRevision]);

  const stats = useMemo(
    () => computeDeckStats(cards, variantProgress, new Date(todayEndTime), heldNew),
    [cards, variantProgress, todayEndTime, heldNew],
  );

  // A card belongs on "today" when any of its three directions is due — the
  // same rule the statistics use, so the banner, the tab badge and this list
  // can never disagree the way they used to.
  // Words some direction of which keeps being forgotten — marked in the list.
  const leechCardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const card of cards) {
      if (ALL_TRAIN_VARIANTS.some((v) => isLeech(getVariantProgress(card, v, variantProgress)))) ids.add(card.id);
    }
    return ids;
  }, [cards, variantProgress]);

  const dueCards = useMemo(
    () => cards.filter((card) => !heldNew.has(card.id) && todaysDirection(card, variantProgress, todayEndTime) !== null),
    [cards, variantProgress, todayEndTime, heldNew],
  );

  // Arriving straight on the training tab (from the dictionary's «тренировать»)
  // never went through the tab button, which is what used to build the queue —
  // so the session starts here instead. Nothing is persisted: the batch's own
  // "all types, all statuses, every direction" is how this one visit runs, not
  // a new preference.
  const batchSessionStartedRef = useRef(false);
  useEffect(() => {
    if (!arrivedForBatch || batchSessionStartedRef.current) return;
    batchSessionStartedRef.current = true;
    startTrainingSession(
      initialFilters.trainStatus,
      initialFilters.trainFilter,
      initialFilters.trainVariants,
      initialFilters.trainBook,
      initialFilters.trainSourceId,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedForBatch]);

  // Arriving on the training tab from «Сегодня» is the same request as pressing
  // «Начать тренировку»: build the queue, or the learner lands on an empty
  // trainer with their reviews one more tap away.
  const directSessionStartedRef = useRef(false);
  useEffect(() => {
    if (initialTab !== "train" || arrivedForBatch || directSessionStartedRef.current) return;
    if (cards.length === 0) return;
    directSessionStartedRef.current = true;
    startTrainingSession(trainStatus, trainFilter, trainVariants);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, arrivedForBatch, cards.length]);

  // --- Restore SRS session when dueCards become available ---
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    // A batch session was just started deliberately; restoring the previous
    // one over it would drop the learner back into unrelated cards.
    if (arrivedForBatch) return;
    if (dueCards.length === 0) return;
    const saved = getSrsSession();
    if (saved && saved.reviewedIds.length > 0) {
      sessionRestoredRef.current = true;
      const queue = makeTrainQueue(trainStatus, trainFilter, trainVariants);
      setTrainQueue(queue);
      setReviewedIds(saved.reviewedIds);
      setCurrentTrainIndex(Math.min(saved.currentIndex, queue.length));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueCards.length]);

  // --- Auto-play audio-variant cards as they come up ---
  useEffect(() => {
    const item = trainQueue[currentTrainIndex];
    if (item?.variant === "audio") void speak(item.card.front, targetLanguage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainQueue, currentTrainIndex]);

  // --- Fetch the audio cards still ahead, before they are reached ---
  //
  // An audio card is nothing but its recording: it appears and immediately
  // plays, so its fetch cannot begin until the learner is already looking at a
  // blank prompt waiting for sound. Asking for the ones further down the queue
  // while this card is being answered means each arrives already fetched.
  //
  // The whole rest of trainQueue, not a fixed few: every card in it already
  // cleared the session's filters and is going to be trained, so none of this
  // is a guess spent on a card the learner might not reach.
  useEffect(() => {
    const upcoming = trainQueue
      .slice(currentTrainIndex + 1)
      .filter((item) => item.variant === "audio")
      .map((item) => item.card.front);
    void prefetchSpeechAhead(upcoming, targetLanguage, "default", upcoming.length);
  }, [trainQueue, currentTrainIndex, targetLanguage]);

  // Switching tabs starts its list from the top again.
  useEffect(() => {
    setVisibleCount(50);
  }, [activeTab]);

  // --- Close menus on outside click ---
  // Checks the click target against the toggle/panel itself (rather than
  // relying on the button's stopPropagation to outrun this document-level
  // listener) — a plain native listener on `document` still observes clicks
  // on elements inside React's tree, so an unconditional close-on-any-click
  // here was undoing the toggle button's own state update on the very same
  // click that opened it.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".all-filter-toggle, .all-filter-panel")) {
        setShowFilterPanel(false);
        setShowTrainFilterPanel(false);
      }
      if (!target.closest(".card-tts-wrap")) setShowTtsMenu(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  // --- Add card (from WordModal / Discuss chat) with duplicate control ---
  async function addCard(front: string, back: string, type: Flashcard["type"], sourceCard?: Flashcard | null) {
    if (!front.trim() || !back.trim()) return;

    if (findDuplicateCard(front, cards)) {
      showToast("Такая карточка уже добавлена");
      return;
    }

    const sourceTitle = sourceCard?.sourceBookTitle ?? sourceCard?.source ?? "Тренажёр";
    const srsFields = createDefaultSrsFields(sourceCard?.sourceBookId ?? null, sourceTitle);
    const localCard: Flashcard = {
      id: `card-${Date.now()}`,
      type,
      source: sourceTitle,
      addedAt: new Date().toISOString(),
      ...srsFields,
      front,
      back,
    };
    if (user) {
      const dbId = await sbInsertFlashcard({
        user_id: user.id,
        vocabulary_item_id: null,
        front: localCard.front,
        back: localCard.back,
        source_book_title: sourceTitle,
        selection_type: type,
        repetitions: srsFields.repetitions,
        lapses: srsFields.lapses,
        easiness_factor: srsFields.easeFactor,
        interval_days: srsFields.intervalDays,
        next_review_at: srsFields.dueAt,
        last_reviewed_at: srsFields.lastReviewedAt,
        source_book_id: srsFields.sourceBookId,
        status: srsFields.status,
      });
      if (dbId) localCard.id = dbId;
    }

    onAddCard(localCard);
    showToast("✓ Карточка добавлена");
  }

  // --- Word tap → WordModal ---
  // The dictionary knows each word's part of speech and level; cards do not
  // carry them. Fetched once when the module opens, matched by the card's
  // front, so a card made from a photographed page shows «сущ. · A1» without a
  // schema change. Cards from the reader fall back to the heuristic below.
  const [wordFacts, setWordFacts] = useState<Map<string, WordFacts>>(new Map());
  // The full dictionary row behind a card, handed to the AI that checks it.
  const [dictionaryEntries, setDictionaryEntries] = useState<Map<string, CardVerifyDictionaryEntry>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dictionary", { headers: await sbAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json() as { entries?: {
          headword: string; lemma: string; part_of_speech: string; cefr: string;
          translation?: string; gender?: string; article?: string; plural?: string;
          forms?: Record<string, string>; note?: string; example?: string; example_translation?: string;
        }[] };
        if (cancelled) return;
        const map = new Map<string, WordFacts>();
        const full = new Map<string, CardVerifyDictionaryEntry>();
        for (const e of data.entries ?? []) {
          const fact = { pos: e.part_of_speech ?? "", cefr: e.cefr ?? "" };
          map.set(normalizeFront(e.headword), fact);
          map.set(normalizeFront(e.lemma), fact);
          const entry: CardVerifyDictionaryEntry = {
            headword: e.headword ?? "",
            lemma: e.lemma ?? "",
            translation: e.translation ?? "",
            partOfSpeech: e.part_of_speech ?? "",
            gender: e.gender ?? "",
            article: e.article ?? "",
            plural: e.plural ?? "",
            forms: e.forms ?? {},
            cefr: e.cefr ?? "",
            note: e.note ?? "",
            example: e.example ?? "",
            exampleTranslation: e.example_translation ?? "",
          };
          // Headword first: the entry a card was made from beats one that
          // merely shares its bare lemma.
          full.set(normalizeFront(e.headword), entry);
          if (!full.has(normalizeFront(e.lemma))) full.set(normalizeFront(e.lemma), entry);
        }
        setWordFacts(map);
        setDictionaryEntries(full);
      } catch {
        // Chips simply fall back to the heuristic.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Part of speech for a card, normalized the same way the Словарь screen's
  // own filter is — so a card carried over with «продолжить изучение» while
  // narrowed to существительное matches exactly what that filter meant.
  // Cards with no dictionary match (added from the reader, say) fall back to
  // the same spelling heuristic the row chip already uses.
  const posOf = useCallback((card: Flashcard): string => {
    const fact = wordFacts.get(normalizeFront(card.front));
    if (fact?.pos) return normalizePos(fact.pos);
    if (card.type !== "word") return "";
    const text = card.front.trim();
    if (/^(der|die|das)\s+\S/i.test(text)) return "существительное";
    if (/^[a-zäöüß]+(en|ern|eln)$/i.test(text)) return "глагол";
    return "";
  }, [wordFacts]);

  const posOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const card of cards) {
      const norm = posOf(card);
      if (!norm || seen.has(norm)) continue;
      const raw = wordFacts.get(normalizeFront(card.front))?.pos?.trim();
      seen.set(norm, raw || norm);
    }
    return Array.from(seen.entries()); // [normalized, label]
  }, [cards, wordFacts, posOf]);

  /** Narrows a card list to one part of speech — "all" leaves it untouched. */
  const filterByPos = useCallback(
    (list: Flashcard[], pos: string) => (pos === "all" ? list : list.filter((c) => posOf(c) === pos)),
    [posOf],
  );

  // --- Training (cards filtered by status and type) ---
  // "hard" draws from ALL cards (not just due today) so problem cards can be
  // drilled any time; the rest filter today's due queue by SRS status.
  // Each selected variant (forward/reverse/audio) carries its own independent
  // schedule (see getVariantProgress), so a card produces one queue item per
  // due variant rather than a single coin-flip.
  const makeTrainQueue = useCallback(
    (
      status: TrainStatus,
      filter: FilterType,
      variants: TrainVariant[],
      book: string = trainBook,
      sourceId: string | null = trainSourceId,
      ignoreSchedule = false,
      excluded: string[] = trainExcluded,
      pos: string = trainPos,
    ): TrainQueueItem[] =>
      // Shuffled so multi-variant sessions interleave instead of running all of
      // one variant before the next.
      shuffleTrainQueue(
        buildTrainQueue(filterByPos(cards, pos), { status, type: filter, variants, book, sourceId, excluded, ignoreSchedule, heldNew, extraHard }, variantProgress, todayEndTime),
      ),
    [cards, variantProgress, todayEndTime, trainBook, trainSourceId, trainExcluded, trainPos, filterByPos, heldNew, extraHard],
  );

  // Live counts for the filter chips, computed in a single pass. Each chip used
  // to build its own full queue on every render, which is what made opening the
  // filter panel — or changing anything at all — take tens of seconds.
  const trainCounts = useMemo(
    () => activeTab === "train"
      ? countTrainCandidates(
        filterByPos(cards, trainPos),
        { status: trainStatus, type: trainFilter, variants: trainVariants, book: trainBook, sourceId: trainSourceId, excluded: trainExcluded, heldNew, extraHard },
        variantProgress,
        todayEndTime,
      )
      : { byStatus: { all: 0, new: 0, learning: 0, review: 0, relearning: 0, hard: 0 }, byType: { all: 0, word: 0, phrase: 0, sentence: 0, expression: 0 } },
    [activeTab, cards, trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, trainExcluded, trainPos, filterByPos, variantProgress, todayEndTime, heldNew, extraHard],
  );

  // The productive trainer keeps its own schedule but must obey the same
  // narrowing: "train this batch" means this batch in either mode.
  const trainCards = useMemo(
    () => activeTab === "train"
      ? filterCardsByTrainingSource(filterByPos(cards, trainPos), trainBook, trainSourceId, trainExcluded)
      : [],
    [activeTab, cards, trainBook, trainSourceId, trainExcluded, trainPos, filterByPos],
  );

  // Every source the deck draws from, with its size — the list the exclusion
  // chips are built from, and what makes «исключить» a decision rather than a
  // guess about how much it would remove.
  const cardSources = useMemo(() => listCardSources(cards), [cards]);

  // What «пройти заново» would actually serve. Shown on the empty state so the
  // offer is a number rather than a promise.
  const drillCandidates = useMemo(
    () => activeTab === "train"
      ? countTrainCandidates(
        filterByPos(cards, trainPos),
        { status: trainStatus, type: trainFilter, variants: trainVariants, book: trainBook, sourceId: trainSourceId, excluded: trainExcluded, ignoreSchedule: true, extraHard },
        variantProgress,
        todayEndTime,
      ).byType.all
      : 0,
    [activeTab, cards, trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, trainExcluded, trainPos, filterByPos, variantProgress, todayEndTime, extraHard],
  );

  // Today's due work in the directions this session leaves out. «Сегодня»
  // counts every direction, so a «Слышу»-only queue that runs dry while a card
  // still waits in «Читаю» used to look like a broken counter.
  const sessionOver = trainQueue.length === 0 || currentTrainIndex >= trainQueue.length;
  const dueElsewhere = useMemo(() => {
    if (activeTab !== "train" || !sessionOver) return 0;
    const others = ALL_TRAIN_VARIANTS.filter((v) => !trainVariants.includes(v));
    if (others.length === 0) return 0;
    return countTrainCandidates(
      filterByPos(cards, trainPos),
      { status: trainStatus, type: trainFilter, variants: others, book: trainBook, sourceId: trainSourceId, excluded: trainExcluded, heldNew, extraHard },
      variantProgress,
      todayEndTime,
    ).byType.all;
  }, [activeTab, sessionOver, cards, trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, trainExcluded, trainPos, filterByPos, variantProgress, todayEndTime, heldNew, extraHard]);

  function trainAllDirections() {
    const variants = [...ALL_TRAIN_VARIANTS];
    setTrainVariants(variants);
    persistCardFilters({ trainVariants: variants });
    startTrainingSession(trainStatus, trainFilter, variants);
  }

  function startTrainingSession(
    status: TrainStatus,
    filter: FilterType,
    variants: TrainVariant[],
    book: string = trainBook,
    sourceId: string | null = trainSourceId,
    ignoreSchedule = false,
    excluded: string[] = trainExcluded,
    pos: string = trainPos,
  ) {
    setTrainQueue(makeTrainQueue(status, filter, variants, book, sourceId, ignoreSchedule, excluded, pos));
    setDrilling(ignoreSchedule);
    setCurrentTrainIndex(0);
    setReviewedIds([]);
    setIsFlipped(false);
    setReviewHistory([]);
    setViewingHistoryIndex(null);
    clearSrsSession();
  }

  /**
   * Leave the dictionary batch and go back to the learner's own training setup.
   *
   * This is the way out of «тренировать эту пачку», and it is the whole reason
   * the batch is never written into the saved filters: the configuration the
   * learner built for themselves is still sitting in the profile, so coming
   * back to it is one call to resolveCardFilters with no batch.
   */
  function startSavedTraining() {
    const restored = resolveCardFilters(profile.cardFilters, null);
    setBatch(null);
    onExitBatch?.();
    setFilterStatus(restored.filterStatus);
    setFilterType(restored.filterType);
    setFilterBook(restored.filterBook);
    setExcludedLevels(restored.filterLevels);
    setFilterPos(restored.filterPos);
    setTrainFilter(restored.trainFilter);
    setTrainStatus(restored.trainStatus);
    setTrainBook(restored.trainBook);
    setTrainSourceId(restored.trainSourceId);
    setTrainExcluded(restored.trainExcluded);
    setTrainVariants(restored.trainVariants);
    setTrainMode(restored.trainMode);
    setTrainPos(restored.trainPos);
    startTrainingSession(
      restored.trainStatus,
      restored.trainFilter,
      restored.trainVariants,
      restored.trainBook,
      restored.trainSourceId,
      false,
      restored.trainExcluded,
      restored.trainPos,
    );
  }

  /**
   * Train around a source instead of through it.
   *
   * Restarts the session, because the queue was built before the learner
   * changed their mind about what belongs in it — leaving the cards they just
   * excluded sitting in front of them would be the filter agreeing and doing
   * nothing.
   */
  function setExcludedSources(excluded: string[]) {
    setTrainExcluded(excluded);
    persistCardFilters({ trainExcluded: excluded });
    startTrainingSession(trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, drilling, excluded);
  }

  /**
   * Train one source and nothing else — or, with null, the deck again.
   *
   * A source with a pack row behind it is matched by its id: two pages
   * photographed on the same day can carry the same title, and matching by
   * title would quietly train both.
   */
  function selectTrainingSource(source: CardSource | null) {
    leaveBatchForOwnChoice();
    const book = source ? source.title : "all";
    const sourceId = source?.packId ?? null;
    setTrainBook(book);
    setTrainSourceId(sourceId);
    persistCardFilters({ trainBook: book, trainSourceId: sourceId });
    startTrainingSession(trainStatus, trainFilter, trainVariants, book, sourceId, drilling, trainExcluded);
  }

  function toggleExcludedSource(key: string) {
    setExcludedSources(
      trainExcluded.includes(key) ? trainExcluded.filter((k) => k !== key) : [...trainExcluded, key],
    );
  }

  /** Picking a source by hand is a deliberate choice, so it ends the batch. */
  function leaveBatchForOwnChoice() {
    if (!batch) return;
    setBatch(null);
    onExitBatch?.();
  }

  const handleGrade = (score: 1 | 2 | 3 | 4) => {
    if (viewingHistoryIndex !== null || trainQueue.length === 0 || currentTrainIndex >= trainQueue.length) return;
    const { card, variant, relearn } = trainQueue[currentTrainIndex];
    const prev = getVariantProgress(card, variant, variantProgress);
    const now = new Date().toISOString();
    // Three answers: «Забыл», «Помню», «Легко». Key 2 (the old «Трудно») counts
    // as «Помню» — the learner remembered it.
    const grade: ReviewGrade = score === 1 ? 1 : score === 4 ? 4 : 3;
    // A relearning pass is practice: the «Забыл» earlier in this session has
    // already scheduled the word for tomorrow, and grading it again minutes
    // later would tell FSRS nothing about memory.
    const stillForgotten = Boolean(relearn);
    const srsUpdate = { ...reviewMemory(prev, grade, new Date(now)), easeFactor: prev.easeFactor };
    // A self-rating, not a checked answer: «Легко» is the learner's own word.
    logTrainingEvent({
      trainer: "review",
      mode: variant,
      cardId: card.id,
      word: card.front,
      checks: variant === "reverse" ? "recall" : variant === "audio" ? "listening" : "recognition",
      outcome: "self_rated",
      selfGrade: grade,
      expected: splitCardBack(card.back).meaning || null,
      meta: { early: Boolean(prev.dueAt && Date.parse(prev.dueAt) > Date.now() + 86_400_000), relearn: Boolean(relearn) },
    });
    if (stillForgotten) {
      // Nothing to save.
    } else if (variant === "forward") {
      onUpdateCard({ ...card, ...srsUpdate, lastReviewedAt: now });
    } else {
      const progress = { ...srsUpdate, lastReviewedAt: now };
      saveCardVariantProgress(card.id, variant, progress);
      setVariantProgress(getCardVariantProgressMap());
      if (user) void pushCardVariant(user.id, card.id, variant, progress);
      // The card's own lastReviewedAt is deliberately left alone: it is the
      // recognition prompt's record, and stamping it here counted one graded
      // reverse prompt as two reviews in «сделано сегодня». The streak reads
      // every direction's timestamp, so today's activity is seen either way.
    }

    // «Забыл» does not end the card's day: like Anki's relearning step it comes
    // back before the session is over, and only a later «помню» lets it go
    // until tomorrow. The forward copy carries the progress just saved, since
    // that direction reads its schedule from the card itself.
    const again = relearnAfterGrade(
      { card, variant, relearn },
      grade,
      variant === "forward" && !stillForgotten ? { ...card, ...srsUpdate, lastReviewedAt: now } : undefined,
    );
    if (again) setTrainQueue((queue) => [...queue, again]);

    setReviewHistory((history) => [...history, { card, variant }]);
    const nextReviewedIds = [...reviewedIds, card.id];
    const nextIndex = currentTrainIndex + 1;
    setReviewedIds(nextReviewedIds);
    saveSrsSession(nextReviewedIds, nextIndex);

    setIsFlipped(false);
    setTimeout(() => setCurrentTrainIndex(nextIndex), 250);
  };

  const restartTraining = () => startTrainingSession(trainStatus, trainFilter, trainVariants);

  /**
   * Go through the same selection again, schedule or no schedule.
   *
   * This is what «пройти пачку заново» has to mean. The old button rebuilt an
   * ordinary queue, which asks "what is due"; every card had been graded
   * seconds earlier, so the honest answer was "nothing", and the learner was
   * shown «нет карточек по выбранным фильтрам» over a pack they had just
   * finished. A first pass through new material is not a review — it is
   * repetition until the words stop being strangers — so this takes everything
   * in scope. Grading still schedules exactly as before.
   */
  const drillAgain = () =>
    startTrainingSession(trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, true);

  /**
   * Switch the direction being drilled without leaving the card.
   *
   * The way a pack is actually learned is a sequence: read it изучаемый →
   * родной first, then turn it round and produce it, then do it by ear. Each
   * of those was three taps into a filter panel; here it is one, right above
   * the card, and it keeps the session's drill setting so a second pass
   * through a pack does not empty itself out.
   */
  const switchDirection = (variant: TrainVariant) => {
    const variants = [variant];
    setTrainVariants(variants);
    persistCardFilters({ trainVariants: variants });
    startTrainingSession(trainStatus, trainFilter, variants, trainBook, trainSourceId, drilling);
  };

  const openLatestReviewedCard = () => {
    if (reviewHistory.length === 0) return;
    setViewingHistoryIndex(reviewHistory.length - 1);
  };

  const closeReviewedCard = () => setViewingHistoryIndex(null);

  // Persists a filter/sort change to the local profile and, for signed-in users,
  // to user_settings — so selections survive reloads and follow the user across devices.
  const persistCardFilters = useCallback((patch: Partial<CardFilters>) => {
    setProfile((prev) => {
      const updatedFilters = { ...prev.cardFilters, ...patch };
      const updated = { ...prev, cardFilters: updatedFilters };
      saveLocalProfile(updated);
      if (user) {
        void sbUpsertSettings({
          user_id: user.id,
          native_language: updated.nativeLanguage,
          active_target_lang: updated.targetLanguage,
          ui_language: updated.uiLanguage,
          tts_provider: updated.ttsProvider ?? "local",
          reading_minutes: updated.readingMinutes,
          books_started: updated.booksStarted,
          books_finished: updated.booksFinished,
          updated_at: new Date().toISOString(),
          card_filters: updatedFilters,
        });
      }
      return updated;
    });
  }, [user]);

  const updateLevelFilter = useCallback((levels: CefrLevel[]) => {
    const nextLevels = [...new Set(levels)];
    setExcludedLevels(nextLevels);
    persistCardFilters({
      filterLevel: "all",
      filterLevels: nextLevels,
      // Kept only so older clients interpret the new list safely.
      filterLevelMode: "exclude",
    });
    setVisibleCount(50);
  }, [persistCardFilters]);

  // Zen is a way of working, not a one-off view, so the choice is remembered
  // the same way the filters are: a learner who trains this way trains this way
  // tomorrow too, without hunting for the button again.
  const setZen = useCallback((on: boolean) => {
    setZenMode(on);
    persistCardFilters({ zenMode: on });
  }, [persistCardFilters]);

  // --- TTS provider change ---
  const handleTtsProviderChange = (provider: TtsProvider, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = { ...profile, ttsProvider: provider };
    saveLocalProfile(updated);
    setProfile(updated);
    setShowTtsMenu(false);
  };

  // Long press on TTS button area → show provider menu
  const handleTtsPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    longPressRef.current = setTimeout(() => setShowTtsMenu(true), 500);
  };
  const handleTtsPointerUp = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  };

  // --- Discuss with AI about a card ---
  async function openDiscussForCard(card: Flashcard, progress?: VariantProgress | null) {
    const cacheKey = makeDiscussCacheKey(discussionModeForCard(card.type), card.front, targetLanguage, nativeLanguage);
    const history = getLocalDiscussHistory(cacheKey);
    setDiscuss({ open: true, card, cacheKey, messages: history, historyLoading: Boolean(user), progress });

    if (!user) return;
    try {
      const remoteHistory = await sbGetDiscussHistory(user.id, cacheKey);
      if (remoteHistory && remoteHistory.length > 0) {
        saveLocalDiscussHistory(cacheKey, remoteHistory);
        setDiscuss((prev) => (prev.cacheKey === cacheKey ? { ...prev, messages: remoteHistory, historyLoading: false } : prev));
      } else {
        setDiscuss((prev) => (prev.cacheKey === cacheKey ? { ...prev, historyLoading: false } : prev));
      }
    } catch {
      setDiscuss((prev) => (prev.cacheKey === cacheKey ? { ...prev, historyLoading: false } : prev));
    }
  }

  function openDiscussForWord(word: string, context?: string) {
    const base = currentCard;
    const card: Flashcard = base
      ? { ...base, front: word, back: context || base.back }
      : {
        id: `discussion-${word}`,
        type: "word",
        front: word,
        back: "",
        source: "Обсуждение слова",
        addedAt: new Date().toISOString(),
        status: "new",
        lapses: 0,
        intervalDays: 0,
        easeFactor: 2.5,
        repetitions: 0,
        dueAt: new Date().toISOString(),
      };
    void openDiscussForCard(card);
  }

  function handleDiscussMessagesChange(messages: DiscussMessage[]) {
    setDiscuss((prev) => ({ ...prev, messages }));
    if (discuss.cacheKey) {
      saveLocalDiscussHistory(discuss.cacheKey, messages);
      if (user) void sbSaveDiscussHistory(user.id, discuss.cacheKey, messages);
    }
  }

  // Which card's story is being written, so its button can spin.
  const [miniStory, setMiniStory] = useState<string | null>(null);

  /**
   * A short text built around the card's word, saved into «Мои уроки».
   *
   * It does not open the text: this fires mid-training, and yanking the
   * learner out of a session they are halfway through would cost more than
   * the text is worth. The toast says where it went.
   */
  async function createMiniStory(card: Flashcard) {
    if (miniStory) return;
    setMiniStory(card.id);
    try {
      const res = await fetch("/api/lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({
          level: ["A1", "A2", "B1", "B2", "C1", "C2"].includes(card.cefr ?? "") ? card.cefr : "A2",
          topic: `Слово «${card.front}»`,
          targetLanguage,
          nativeLanguage,
          reviewWords: [card.front],
          length: "short",
          context: `Короткий рассказ вокруг слова «${card.front}» (${card.back.split("\n")[0]}): показать его в нескольких типичных ситуациях и формах.`,
        }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Не удалось создать рассказ.");
      showToast("✓ Рассказ сохранён в «Мои уроки»");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Не удалось создать рассказ.");
    } finally {
      setMiniStory(null);
    }
  }

  /**
   * `card` is the flashcard the word was tapped on, when there is one. The
   * bare spelling is ambiguous — "Stelle" is a noun on «die Stelle» but also
   * a form of «stellen» — so the lookup is given the card's front and meaning
   * and cached per card rather than per spelling: a spelling-only cache entry
   * made by one reading would otherwise be served to every other card.
   */
  const openWordModalFor = useCallback(async (word: string, card?: Flashcard | null) => {
    const norm = normalizeToken(word);
    if (!norm) return;

    // Open modal immediately with loading state
    setWordModal({ open: true, word: norm, analysis: null, loading: true });

    const cardContext = card ? { front: card.front, back: card.back } : undefined;
    const cacheKey = cardContext
      ? makeWordContextCacheKey(norm, cardContext.front, splitCardBack(cardContext.back).meaning, "", targetLanguage, nativeLanguage)
      : makeAiCacheKey("word", norm, targetLanguage, nativeLanguage);
    const cached = getLocalAiAnalysis(cacheKey);
    if (cached?.word?.translation) {
      setWordModal({ open: true, word: norm, analysis: cached, loading: false });
      return;
    }

    try {
      const result = await analyzeSelection({
        mode: "word",
        word: norm,
        text: norm,
        sentence: cardContext?.front ?? norm,
        sentenceBefore: "",
        sentenceAfter: "",
        cardContext,
        nativeLanguage,
        targetLanguage,
      });
      saveLocalAiAnalysis(cacheKey, result);
      setWordModal({ open: true, word: norm, analysis: result, loading: false });
    } catch {
      setWordModal({ open: true, word: norm, analysis: null, loading: false });
    }
  }, [targetLanguage, nativeLanguage]);

  const openFixCallback = useCallback((card: Flashcard) => setFixCard(card), []);

  /**
   * Saves the AI's corrected card. Progress, schedule and id stay as they
   * were: the card is the same card, only its text changed. Refuses a front
   * that another card already has, so a fix cannot create a duplicate — the
   * modal is handed that card instead and offers to drop this one.
   */
  const applyCardFix = useCallback((front: string, back: string): CardFixApplyResult => {
    if (!fixCard) return { error: "Карточка не найдена." };
    const clash = findDuplicateCard(front, cards);
    if (clash && clash.id !== fixCard.id) return { duplicate: clash };
    onUpdateCard({ ...fixCard, front, back });
    // The session holds snapshots of its cards, so the card on screen (and in
    // the review history) would keep its old text until the session restarted.
    const refresh = (item: TrainQueueItem): TrainQueueItem =>
      item.card.id === fixCard.id ? { ...item, card: { ...item.card, front, back } } : item;
    setTrainQueue((queue) => queue.map(refresh));
    setReviewHistory((history) => history.map(refresh));
    return null;
  }, [fixCard, cards, onUpdateCard]);

  /**
   * Deletes the card being fixed: its corrected text turned out to be a card
   * the learner already has, so this one is just a wrong copy of it. The
   * session drops it too, keeping the card on screen where it was — the next
   * one simply moves up into its place.
   */
  const deleteFixedDuplicate = useCallback(() => {
    if (!fixCard) return;
    const id = fixCard.id;
    onDeleteCard(id);
    const removedBefore = trainQueue.slice(0, currentTrainIndex).filter((item) => item.card.id === id).length;
    if (trainQueue[currentTrainIndex]?.card.id === id) setIsFlipped(false);
    setTrainQueue((queue) => queue.filter((item) => item.card.id !== id));
    setCurrentTrainIndex((index) => Math.max(0, index - removedBefore));
    setReviewHistory((history) => history.filter((item) => item.card.id !== id));
    setViewingHistoryIndex(null);
  }, [fixCard, onDeleteCard, trainQueue, currentTrainIndex]);

  const handleWordTap = useCallback((word: string, e: React.MouseEvent, card?: Flashcard | null) => {
    e.stopPropagation();
    void openWordModalFor(word, card);
  }, [openWordModalFor]);

  /**
   * «Как это сказать» for one word of a native-language prompt.
   *
   * Cached under its own key so it can never be confused with the ordinary
   * analysis of a word that happens to be spelled the same — the two answers
   * are in different languages.
   */
  const openReverseWordFor = useCallback(async (word: string, sentence: string) => {
    const norm = word.trim();
    if (!norm) return;

    setReverseWord({ open: true, word: norm, analysis: null, loading: true });

    const cacheKey = makeAiCacheKey("reverse-word", norm, targetLanguage, nativeLanguage);
    const cached = getLocalAiAnalysis(cacheKey);
    if (cached?.reverse?.entries?.length) {
      setReverseWord({ open: true, word: norm, analysis: cached.reverse, loading: false });
      return;
    }

    try {
      const result = await analyzeSelection({
        mode: "word",
        direction: "native-to-target",
        word: norm,
        text: norm,
        sentence: sentence || norm,
        sentenceBefore: "",
        sentenceAfter: "",
        nativeLanguage,
        targetLanguage,
      });
      if (result.reverse?.entries?.length) saveLocalAiAnalysis(cacheKey, result);
      setReverseWord({ open: true, word: norm, analysis: result.reverse ?? null, loading: false });
    } catch {
      setReverseWord({ open: true, word: norm, analysis: null, loading: false });
    }
  }, [targetLanguage, nativeLanguage]);

  // Bound to the prompt it belongs to, so the sentence the word sits in can
  // pick the right sense of it.
  const handleNativeWordTap = useCallback((word: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const sentence = (e.currentTarget as HTMLElement | null)?.closest(".card-text-area")?.textContent ?? "";
    void openReverseWordFor(word, sentence.trim());
  }, [openReverseWordFor]);

  // --- Dynamic font size for card text ---
  /**
   * How big the prompt is set, from how much of it there is.
   *
   * Fixed pixel sizes were tuned on a wide screen and a single German word;
   * a whole sentence — or its Russian translation, which runs a third longer —
   * arrived at 22px on a 360px phone and had nowhere to go. These scale with
   * the viewport between a floor that stays readable and a ceiling that keeps
   * a short word looking like a headline.
   */
  function cardFontSize(text: string): string {
    if (text.length > 200) return "clamp(12px, 3.2vw, 14px)";
    if (text.length > 120) return "clamp(13px, 3.8vw, 16px)";
    if (text.length > 60) return "clamp(15px, 4.4vw, 19px)";
    if (text.length > 28) return "clamp(17px, 5.4vw, 23px)";
    return "clamp(20px, 6.6vw, 28px)";
  }

  // --- All Cards filtering & sorting ---
  const allBooks = useMemo(
    () => Array.from(new Set(cards.map((c) => c.sourceBookTitle || c.source || "").filter(Boolean))),
    [cards],
  );
  // Keep every CEFR level available in the filter, including levels that do
  // not occur in the current deck yet. This lets a saved/empty C2 filter be
  // selected and makes the full A1–C2 range discoverable in the trainer.
  const cardLevels = CEFR_LEVELS;
  const activeFilterCount = [filterStatus !== "all", filterType !== "all", filterBook !== "all", excludedLevels.length > 0, filterPos !== "all"].filter(Boolean).length;
  const variantsAreDefault = trainVariants.length === 1 && trainVariants[0] === "forward";
  // With one source picked there is nothing for the exclusions to remove — the
  // chips stay visible (so the learner can see what they set) but say so.
  const narrowedToOneSource = trainBook !== "all" || Boolean(trainSourceId);
  // Which row the picker shows a tick against, and what the summary names.
  const selectedSource = useMemo(
    () => cardSources.find((source) => (trainSourceId ? source.key === trainSourceId : source.title === trainBook)) ?? null,
    [cardSources, trainSourceId, trainBook],
  );
  const activeTrainFilterCount = [trainFilter !== "all", trainStatus !== "all", trainBook !== "all", trainPos !== "all", trainExcluded.length > 0, !variantsAreDefault].filter(Boolean).length;

  const filteredAllCards = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return cards
      .filter((c) => {
        if (filterStatus !== "all" && c.status !== filterStatus) return false;
        if (filterType !== "all" && c.type !== filterType) return false;
        if (filterBook !== "all" && (c.sourceBookTitle || c.source || "") !== filterBook) return false;
        if (!matchesCefrFilter(c.cefr, excludedLevels, "exclude")) return false;
        if (filterPos !== "all" && posOf(c) !== filterPos) return false;
        if (query) return c.front.toLowerCase().includes(query) || c.back.toLowerCase().includes(query) || (c.sourceBookTitle || c.source || "").toLowerCase().includes(query);
        return true;
      })
      .sort((a, b) => {
        if (sortOrder === "due") return Date.parse(a.dueAt) - Date.parse(b.dueAt);
        if (sortOrder === "ease") return a.easeFactor - b.easeFactor;
        return Date.parse(b.addedAt) - Date.parse(a.addedAt);
      });
  }, [cards, filterStatus, filterType, filterBook, excludedLevels, filterPos, posOf, searchQuery, sortOrder]);

  // Both long lists page in as they are scrolled: rendering 500-plus rows at
  // once cost more than everything else on the screen put together.
  const visibleCards = useMemo(() => filteredAllCards.slice(0, visibleCount), [filteredAllCards, visibleCount]);
  const visibleDueCards = useMemo(() => dueCards.slice(0, visibleCount), [dueCards, visibleCount]);
  const hasMoreRows = activeTab === "today"
    ? visibleCount < dueCards.length
    : visibleCount < filteredAllCards.length;

  const deleteFilteredCards = useCallback(() => {
    if (activeFilterCount === 0 || filteredAllCards.length === 0) return;
    const count = filteredAllCards.length;
    const scope = searchQuery.trim()
      ? "по текущему фильтру и поиску"
      : "по текущему фильтру";
    if (!confirm(`Удалить все ${count} ${cardNoun(count)} ${scope}? Это действие нельзя отменить.`)) return;
    onDeleteCards(filteredAllCards.map((card) => card.id));
    setShowFilterPanel(false);
    setVisibleCount(50);
    setToast(`Удалено ${count} ${cardNoun(count)}`);
    window.setTimeout(() => setToast(null), 2500);
  }, [activeFilterCount, filteredAllCards, onDeleteCards, searchQuery]);

  // --- Infinite scroll for the long lists (Today and All Cards) ---
  // Re-attached whenever the sentinel could have been unmounted, so a list that
  // shrinks below one page and grows again keeps paging.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((n) => n + 50); },
      { rootMargin: "200px" }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [activeTab, hasMoreRows]);

  // Today's plan is what has been done plus what is left, so the bar fills as
  // the session runs and stretches honestly when new cards are added mid-day.
  const todayPlanned = stats.reviewedToday + stats.dueReps;
  const todayDonePct = todayPlanned > 0 ? Math.round((stats.reviewedToday / todayPlanned) * 100) : 100;

  const openDiscussCallback = useCallback((card: Flashcard) => { void openDiscussForCard(card); }, [targetLanguage, nativeLanguage, user]);

  // «Перейти к флешкарте» shows one card exactly as the trainer does — every
  // button, the verb forms, the flip — but no grades: looking at a card from
  // the reader or a list must never move its schedule.
  const previewCard = previewCardId ? cards.find((c) => c.id === previewCardId) ?? null : null;
  const [shownPreviewId, setShownPreviewId] = useState(previewCardId);
  if (previewCardId !== shownPreviewId) {
    setShownPreviewId(previewCardId);
    setIsFlipped(false);
  }
  const currentItem = previewCard ? { card: previewCard, variant: "forward" as TrainVariant } : trainQueue[currentTrainIndex];
  const currentCard = currentItem?.card as Flashcard;
  const currentVariant: TrainVariant = currentItem?.variant ?? "forward";
  const isReversed = currentVariant === "reverse";
  const isAudio = currentVariant === "audio";
  const backParts = splitCardBack(currentCard?.back ?? "");
  const promptText = isReversed ? backParts.meaning : currentCard?.front;
  const answerText = isReversed ? currentCard?.front : currentCard?.back;
  const promptLang = isReversed ? nativeLanguage : targetLanguage;
  const currentProgress = currentCard ? getVariantProgress(currentCard, currentVariant, variantProgress) : null;
  const historyPosition = getReviewHistoryPosition(reviewHistory.length, viewingHistoryIndex);
  const historyItem = historyPosition ? reviewHistory[historyPosition.index] : null;
  const historyCard = historyItem?.card;
  const historyBackParts = splitCardBack(historyCard?.back ?? "");
  // A verb's back always shows Präteritum, Perfekt and the verb class — for
  // old cards too, looked up once and cached (see useCardVerbSummary).
  const currentVerb = useCardVerbSummary(currentCard, targetLanguage, nativeLanguage,
    currentCard ? dictionaryEntries.get(normalizeFront(currentCard.front)) : undefined);
  const historyVerb = useCardVerbSummary(historyCard, targetLanguage, nativeLanguage,
    historyCard ? dictionaryEntries.get(normalizeFront(historyCard.front)) : undefined);
  // Memoized per card so the tokenized spans are not rebuilt on every render.
  const handleCurrentWordTap = useCallback(
    (word: string, e: React.MouseEvent) => handleWordTap(word, e, currentCard),
    [handleWordTap, currentCard],
  );
  const handleHistoryWordTap = useCallback(
    (word: string, e: React.MouseEvent) => handleWordTap(word, e, historyCard),
    [handleWordTap, historyCard],
  );

  // Zen only takes over while there is a card to sit alone on the screen. The
  // finished-session summary, an empty queue and the productive trainer all
  // keep the ordinary page — which is also what makes the queue running out a
  // way back to the rest of the module rather than a dead end.
  const zenActive = zenMode
    && activeTab === "train"
    && trainMode === "recognize"
    && trainQueue.length > 0
    && currentTrainIndex < trainQueue.length;

  // A full-screen trainer over a scrolled page would otherwise let the page
  // behind it move under the finger — the very thing zen exists to stop.
  useEffect(() => {
    if (!zenActive) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [zenActive]);

  // --- Keyboard control for the recognize trainer ---
  //
  // Bound only while a card is actually on screen, and never over a modal or a
  // field the learner is typing into, so the digits stay available to the
  // search box and the chat.
  const hotkeysActive = ((activeTab === "train" && trainMode === "recognize") || Boolean(previewCard))
    && !wordModal.open
    && !reverseWord.open
    && !showKeysModal
    && !discuss.open
    && !fixCard
    && (Boolean(currentCard) || Boolean(historyPosition));

  useEffect(() => {
    if (!hotkeysActive) return;

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = trainerHotkey(e, { playerOpen });
      if (!action) return;

      // Browsing a graded card is read-only by design, so the keys that would
      // change it do nothing rather than quietly rescheduling a card the
      // learner is only looking at.
      const browsing = !previewCard && historyPosition !== null;
      const speakTarget = browsing ? historyCard : currentCard;

      switch (action.kind) {
        case "grade":
          if (browsing || !currentCard || previewCard) return;
          handleGrade(action.score);
          break;
        case "speak":
          if (!speakTarget) return;
          void speak(speakTarget.front, targetLanguage);
          break;
        case "respeak":
          // Same rule as the button on the card: what is spoken is always the
          // language being learned, whichever side is showing.
          if (!speakTarget) return;
          void respeak(speakTarget.front, targetLanguage);
          break;
        case "playerRepeat":
          toggleRepeat();
          break;
        case "playerClose":
          stopTTS();
          break;
        case "flip":
          if (browsing || !currentCard) return;
          setIsFlipped((f) => !f);
          break;
        case "story":
          if (browsing || !currentCard) return;
          void createMiniStory(currentCard);
          break;
        case "discuss":
          if (!speakTarget) return;
          void openDiscussForCard(speakTarget);
          break;
        case "historyOlder":
          if (previewCard || reviewHistory.length === 0) return;
          // Not yet browsing: the first step back opens the card just graded.
          if (!historyPosition) openLatestReviewedCard();
          else if (historyPosition.canGoOlder) setViewingHistoryIndex(historyPosition.index - 1);
          break;
        case "historyNewer":
          if (previewCard || !historyPosition) return;
          // Past the newest reviewed card is the live one, which is where the
          // «Следующая» button leads too.
          if (historyPosition.canGoNewer) setViewingHistoryIndex(historyPosition.index + 1);
          else closeReviewedCard();
          break;
        case "live":
          if (previewCard) return;
          closeReviewedCard();
          break;
        case "zenExit":
          // Escape means "give me the page back". With nothing hidden there is
          // nothing to escape from, so the key is left to the browser.
          if (!zenActive) return;
          setZen(false);
          break;
      }
      e.preventDefault();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeysActive, playerOpen, historyPosition?.index, historyPosition?.canGoOlder, historyPosition?.canGoNewer, reviewHistory.length, currentCard?.id, historyCard?.id, targetLanguage, currentTrainIndex, trainQueue, viewingHistoryIndex, miniStory, zenActive, setZen]);

  // The card itself — one copy for the trainer and for «Перейти к флешкарте».
  const cardFlipper = currentCard ? (
              <div className="flipper-perspective" style={{ marginBottom: 16 }}>
                <div className={`flipper-card ${isFlipped ? "flipped" : ""}`}>
                  {/* Front */}
                  <div className="flipper-face flipper-face-front" onClick={() => setIsFlipped((f) => !f)}>
                    {/* One row of actions across the top. There used to be a
                        stack of badges opposite them — type, part of speech,
                        level — which said what the card already says and cost
                        the text the whole top of the card. */}
                    <div className="card-actions-right">
                      <button
                        className="card-action-btn"
                        type="button"
                        aria-label="Мини-рассказ с этим словом"
                        title="Мини-рассказ с этим словом — сохранится в «Мои уроки»"
                        disabled={miniStory === currentCard.id}
                        onClick={(e) => { e.stopPropagation(); void createMiniStory(currentCard); }}
                      >
                        {miniStory === currentCard.id ? <Loader2 size={22} className="spin" /> : <FileText size={22} />}
                      </button>
                      <button
                        className="card-action-btn"
                        type="button"
                        aria-label="Проверить и исправить карточку"
                        title="Проверить и исправить карточку"
                        onClick={(e) => { e.stopPropagation(); setFixCard(currentCard); }}
                      >
                        <ShieldCheck size={22} />
                      </button>
                      <button
                        className="card-action-btn"
                        type="button"
                        aria-label="Обсудить с AI"
                        title="Обсудить с AI"
                        onClick={(e) => { e.stopPropagation(); void openDiscussForCard(currentCard, currentProgress); }}
                      >
                        <MessageCircle size={22} />
                      </button>
                      {/* Re-record. Shown wherever something is actually spoken:
                          a reversed prompt is the learner's own language and is
                          never read aloud, so there is nothing there to fix. */}
                      {!isReversed && (
                        <RespeakButton
                          text={isAudio ? currentCard.front : promptText}
                          lang={isAudio ? targetLanguage : promptLang}
                        />
                      )}
                      {/* TTS button — long press or right-click to change provider.
                          Hidden when the prompt is native-language text (speaking it
                          back is pointless) or audio mode (its own play button covers this). */}
                      {!isReversed && !isAudio && (
                        <div
                          className="card-tts-wrap"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={handleTtsPointerDown}
                          onPointerUp={handleTtsPointerUp}
                          onPointerLeave={() => { if (longPressRef.current) clearTimeout(longPressRef.current); }}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setShowTtsMenu(true); }}
                        >
                          <SpeakButton text={promptText} lang={promptLang} size={22} />
                          {showTtsMenu && (
                            <div className="tts-menu" onClick={(e) => e.stopPropagation()}>
                              {ttsProvidersFor(targetLanguage).map((p) => (
                                <div
                                  key={p.value}
                                  className={`tts-menu-item ${profile.ttsProvider === p.value ? "active" : ""}`}
                                  onClick={(e) => handleTtsProviderChange(p.value, e)}
                                >
                                  {p.label}
                                  {profile.ttsProvider === p.value ? " ✓" : ""}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="card-text-area">
                      {isAudio ? (
                        <div className="audio-prompt">
                          <button
                            type="button"
                            className="audio-play-btn"
                            aria-label="Прослушать"
                            onClick={(e) => { e.stopPropagation(); void speak(currentCard.front, targetLanguage); }}
                          >
                            <Volume2 size={26} />
                          </button>
                          <span className="audio-prompt-lbl">Нажмите, чтобы услышать</span>
                        </div>
                      ) : isReversed ? (
                        /* Tappable, like the other side — but asking the
                           opposite question. One unknown word in a phrase the
                           learner otherwise understands used to cost them the
                           whole card: flipping it to find that one word gives
                           away the answer they were about to produce. */
                        <TokenizedText
                          text={promptText}
                          style={{ fontSize: cardFontSize(promptText), fontWeight: 800, userSelect: "none", lineHeight: 1.3 }}
                          onWordTap={handleNativeWordTap}
                        />
                      ) : (
                        <TokenizedText
                          text={promptText}
                          style={{ fontSize: cardFontSize(promptText), fontWeight: 800, userSelect: "none", lineHeight: 1.3 }}
                          onWordTap={handleCurrentWordTap}
                        />
                      )}
                    </div>

                    <div className="card-footer-row">
                      <span>{currentCard.sourceBookTitle || currentCard.source}</span>
                      {currentProgress?.status === "new" && (
                        <span style={{ color: "var(--accent)", fontWeight: 800, flexShrink: 0, maxWidth: "none" }}>НОВАЯ</span>
                      )}
                      {/* A leech: repeating it has not worked, so the card offers
                          the discussion, which opens on a memory hook for it. */}
                      {currentProgress && isLeech(currentProgress) && (
                        <button
                          type="button"
                          className="leech-chip"
                          title={`Забыто ${currentProgress.lapses} раз — обсудить с AI`}
                          onClick={(e) => { e.stopPropagation(); void openDiscussForCard(currentCard, currentProgress); }}
                        >
                          <MessageCircle size={12} /> пиявка · {currentProgress.lapses}×
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Back */}
                  <div className="flipper-face flipper-face-back" onClick={() => setIsFlipped((f) => !f)}>
                    {(isReversed || isAudio) && (
                      <div className="card-actions-right">
                        <RespeakButton text={currentCard.front} lang={targetLanguage} />
                        <div className="card-tts-wrap" onClick={(e) => e.stopPropagation()}>
                          <SpeakButton text={currentCard.front} lang={targetLanguage} size={22} />
                        </div>
                      </div>
                    )}
                    <div className="card-text-area">
                      {isAudio ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                          <TokenizedText
                            text={currentCard.front}
                            style={{ fontSize: cardFontSize(currentCard.front), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3, textAlign: "center" }}
                            onWordTap={handleCurrentWordTap}
                          />
                          <div style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>{backParts.meaning}</div>
                          {currentVerb.summary && <CardVerbForms summary={currentVerb.summary} />}
                          {currentVerb.details && (
                            <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", whiteSpace: "pre-line" }}>{currentVerb.details}</div>
                          )}
                        </div>
                      ) : isReversed ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                          <TokenizedText
                            text={answerText}
                            style={{ fontSize: cardFontSize(answerText), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3 }}
                            onWordTap={handleCurrentWordTap}
                          />
                          {currentVerb.summary && <CardVerbForms summary={currentVerb.summary} />}
                          {currentVerb.details && (
                            <div style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center", whiteSpace: "pre-line" }}>
                              {currentVerb.details}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                          <div style={{ fontSize: cardFontSize(backParts.meaning), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3, textAlign: "center" }}>
                            {backParts.meaning}
                          </div>
                          {currentVerb.summary && <CardVerbForms summary={currentVerb.summary} />}
                          {currentVerb.details && (
                            <div style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center", whiteSpace: "pre-line" }}>
                              {currentVerb.details}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="card-footer-row">
                      <span>Повторений: {currentProgress?.repetitions ?? 0}</span>
                      <span style={{ maxWidth: "none" }} title="Насколько вероятно вспомнить слово прямо сейчас (FSRS)">
                        {currentProgress && currentProgress.status !== "new" ? `Вспомню: ${Math.round(recallChance(currentProgress) * 100)}%` : "Новое"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
  ) : null;

  return (
    <section
      className={`screen${zenActive ? " srs-zen" : ""}`}
      onClick={() => { setShowFilterPanel(false); setShowTtsMenu(false); }}
    >
      <style>{CARDS_STYLES}</style>

      {/* Word Modal */}
      <WordModal
        analysis={wordModal.analysis}
        isOpen={wordModal.open}
        isLoading={wordModal.loading}
        lang={targetLanguage}
        nativeLang={nativeLanguage}
        selectedWord={wordModal.word}
        onClose={() => setWordModal((s) => ({ ...s, open: false }))}
        onAddCard={() => void addCard(wordModal.word, wordModal.analysis?.word?.translation ?? "", "word")}
        onAddLemma={(lemma) => void addCard(lemma, wordModal.analysis?.word?.translation ?? "", "word")}
        onWordTap={(word) => void openWordModalFor(word)}
        onDiscuss={(word, context) => openDiscussForWord(word, context)}
        onAddExample={(text, translation) => void addCard(text, translation, "phrase")}
        onFindVideos={onFindVideos ? (word) => onFindVideos(word, targetLanguage) : undefined}
      />

      {/* «Как это сказать» — a word tapped on a native-language prompt */}
      <ReverseWordModal
        isOpen={reverseWord.open}
        isLoading={reverseWord.loading}
        word={reverseWord.word}
        analysis={reverseWord.analysis}
        lang={targetLanguage}
        onClose={() => setReverseWord((s) => ({ ...s, open: false }))}
        onAddCard={(front, back) => void addCard(front, back, "word", currentCard ?? null)}
      />

      {fixCard && (
        <CardFixModal
          key={fixCard.id}
          card={fixCard}
          entry={dictionaryEntries.get(normalizeFront(fixCard.front))
            ?? dictionaryEntries.get(normalizeFront(fixCard.front.replace(/^(der|die|das)s+/i, "")))
            ?? null}
          targetLanguage={targetLanguage}
          nativeLanguage={nativeLanguage}
          onApply={applyCardFix}
          onDeleteDuplicate={deleteFixedDuplicate}
          onClose={() => setFixCard(null)}
        />
      )}

      {showKeysModal && <TrainerKeysModal onClose={() => setShowKeysModal(false)} />}

      {showSourcePicker && (
        <SourcePickerModal
          sources={cardSources}
          selectedKey={selectedSource?.key ?? null}
          excluded={trainExcluded}
          onSelect={(source) => selectTrainingSource(source)}
          onToggleExcluded={toggleExcludedSource}
          onClearExcluded={() => setExcludedSources([])}
          onClose={() => setShowSourcePicker(false)}
        />
      )}

      {/* Discuss with AI about a card */}
      {discuss.card && (
        <DiscussAiModal
          isOpen={discuss.open}
          isHistoryLoading={discuss.historyLoading}
          mode={discussionModeForCard(discuss.card.type)}
          selectedText={discuss.card.front}
          sentence={discuss.card.front}
          nativeLanguage={nativeLanguage}
          targetLanguage={targetLanguage}
          messages={discuss.messages}
          wordProfile={discussWordProfile}
          onMessagesChange={handleDiscussMessagesChange}
          onClose={() => setDiscuss((prev) => ({ ...prev, open: false }))}
          onWordTap={(word) => void openWordModalFor(word)}
          onAddExample={(text, translation) => void addCard(text, translation, "phrase", discuss.card)}
        />
      )}

      {/* Screen Header — stays pinned while the card lists scroll */}
      <header className="screen-header srs-sticky-header">
        <button className="icon-btn" onClick={previewCard ? onClosePreview : onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">{previewCard ? "Флешкарта" : "Интервальное повторение"}</p>
          <h1>{previewCard ? "Просмотр" : "SRS Тренажер"}</h1>
        </div>
        {previewCard ? <span className="icon-btn-spacer" aria-hidden /> : (
          <button className="icon-btn" onClick={() => setActiveTab("all")} type="button" aria-label="Все карточки">
            <Layers size={20} />
          </button>
        )}
      </header>

      {previewCard ? (
        <div className="srs-train-stage srs-preview-stage">
          {cardFlipper}
        </div>
      ) : (<>

      {/* Today's progress — the one line that has to move on every grade.
          It used to lead with the number of cards due, which only drops once
          all three of a card's directions are done: a learner could grade
          fifteen prompts and watch "177" sit there unchanged. Repetitions are
          the unit a session is actually counted in, so that is what leads. */}
      <div className="srs-today">
        <div className="srs-today-head">
          <div className="srs-today-lead">
            <span className="srs-today-remaining">{stats.dueReps}</span>
            <span className="srs-today-lbl">
              {stats.dueReps === 0 ? "на сегодня всё" : "повторений осталось"}
            </span>
          </div>
          <div className="srs-today-side">
            <span className="srs-today-done">{stats.reviewedToday} из {todayPlanned}</span>
            <span className="srs-today-sub">сделано сегодня · {stats.dueCards} карт.</span>
          </div>
        </div>
        <div className="srs-today-bar" role="progressbar" aria-valuenow={todayDonePct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${todayDonePct}%` }} />
        </div>
        {stats.heldNewCards > 0 && (
          <div className="srs-today-sub" style={{ marginBottom: 6 }}>
            Новых на потом: {stats.heldNewCards} · лимит {newPerDay} в день
          </div>
        )}
        <div className="srs-today-foot">
          <span className="srs-today-chip" title={`Лучшая серия: ${stats.bestStreak} дн.`}>
            <Flame size={12} fill={stats.streak > 0 ? "var(--accent)" : "none"} />
            {stats.streak} дн. подряд
          </span>
          <span className="srs-today-chip" title="Карточек, которые вы уже хотя бы раз повторили">
            {stats.learnedCards} из {stats.totalCards} изучено
          </span>
          <button
            className={`srs-stats-toggle ${showStats ? "active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setShowStats((v) => !v); }}
            type="button"
            aria-expanded={showStats}
          >
            <BarChart3 size={13} /> Разбор
            <ChevronDown size={12} style={{ transform: showStats ? "rotate(180deg)" : undefined, transition: "transform 0.18s" }} />
          </button>
        </div>
      </div>

      {showStats && <StatsPanel stats={stats} onClick={(e) => e.stopPropagation()} />}

      {/* Navigation Tabs */}
      <div className="srs-tabs-container">
        <button className={`srs-tab ${activeTab === "today" ? "active" : ""}`} onClick={() => setActiveTab("today")} type="button">
          Сегодня
          <span className={`srs-tab-badge ${dueCards.length === 0 ? "empty" : ""}`}>{dueCards.length}</span>
        </button>
        <button
          className={`srs-tab ${activeTab === "train" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("train");
            if (trainQueue.length === 0 || currentTrainIndex >= trainQueue.length) restartTraining();
          }}
          type="button"
        >
          Тренировка
        </button>
        <button className={`srs-tab ${activeTab === "all" ? "active" : ""}`} onClick={() => setActiveTab("all")} type="button">
          Все карточки
          <span className="srs-tab-badge empty">{cards.length}</span>
        </button>
      </div>

      {/* TAB: TODAY */}
      {activeTab === "today" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {dueCards.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={44} style={{ color: "var(--green)" }} />
              <strong>Вы полностью свободны!</strong>
              <p>На сегодня все карточки успешно повторены. Отдыхайте или читайте новые книги.</p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>
                  К повторению ({dueCards.length}):
                </span>
                <button
                  className="pill-btn"
                  onClick={() => { startSavedTraining(); setActiveTab("train"); }}
                  type="button"
                  title={batch ? "Начнёт обычную тренировку — фильтр пачки будет снят" : undefined}
                >
                  <Play size={14} fill="currentColor" /> Начать тренировку
                </button>
              </div>
              <div className="card-list">
                {visibleDueCards.map((card) => (
                  <DueCardRow key={card.id} card={card} skillState={skillProgress[card.id] ?? EMPTY_SKILL_STATE} />
                ))}
                {hasMoreRows && <div ref={sentinelRef} style={{ height: 1 }} />}
              </div>
              {hasMoreRows && (
                <button className="srs-list-more" type="button" onClick={() => setVisibleCount((n) => n + 50)}>
                  Показать ещё ({dueCards.length - visibleDueCards.length})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB: TRAINING */}
      {activeTab === "train" && (
        <div className="srs-train-tab" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* A batch narrows the deck without touching the saved filters, so it
              has to say so — otherwise a session pinned to one photographed
              page looks like the whole deck having gone missing. */}
          {batch && (
            <div className="srs-batch-banner">
              <Layers size={16} />
              <div className="srs-batch-copy">
                <strong>Пачка «{batch.title}»</strong>
                {/* A pack with a setup of its own has to say what it is, or the
                    trainer looks as if it quietly ignored the filters. */}
                <span>
                  {batchTrainingSummary
                    ? `Настройка пачки: ${batchTrainingSummary}`
                    : "Ваши обычные фильтры сохранены и вернутся"}
                </span>
                {batchTrainingNote && <span>{batchTrainingNote}</span>}
              </div>
              <button className="srs-batch-exit" type="button" onClick={startSavedTraining}>
                Выйти
              </button>
            </div>
          )}

          {/* Mode switch (passive recognition vs active production) + the
              filters toggle share one row so they don't cost extra vertical
              space above the fold. */}
          <div className="srs-train-controls" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div className="mode-switch">
              <button className={`mode-switch-opt ${trainMode === "recognize" ? "active" : ""}`} onClick={() => { setTrainMode("recognize"); persistCardFilters({ trainMode: "recognize" }); }} type="button">Узнавание</button>
              <button className={`mode-switch-opt ${trainMode === "active" ? "active" : ""}`} onClick={() => { setTrainMode("active"); persistCardFilters({ trainMode: "active" }); }} type="button">Активно</button>
            </div>
            {trainMode === "recognize" && (
              <button
                className={`all-filter-toggle pill ${showTrainFilterPanel ? "active" : ""}`}
                onClick={(e) => { e.stopPropagation(); setShowTrainFilterPanel((v) => !v); }}
                type="button"
              >
                <SlidersHorizontal size={15} /> Фильтры
                {activeTrainFilterCount > 0 && <span className="all-filter-count">{activeTrainFilterCount}</span>}
                <ChevronDown size={12} />
              </button>
            )}
          </div>

          {/* Direction, in the open. It is the one setting that changes what
              a pass through a pack *is* — read it, produce it, or hear it —
              and burying it three taps deep in the filter panel made going
              round the same pack a second way an errand. */}
          {trainMode === "recognize" && (
            <div className="srs-dir-row" role="group" aria-label="Направление тренировки">
              {ALL_TRAIN_VARIANTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`srs-dir-chip${trainVariants.length === 1 && trainVariants[0] === v ? " active" : ""}`}
                  aria-pressed={trainVariants.length === 1 && trainVariants[0] === v}
                  onClick={(e) => { e.stopPropagation(); switchDirection(v); }}
                  title={TRAIN_VARIANT_LABELS[v]}
                >
                  {VARIANT_SHORT_LABELS[v]}
                </button>
              ))}
              <button
                type="button"
                className={`srs-dir-chip${trainVariants.length > 1 ? " active" : ""}`}
                aria-pressed={trainVariants.length > 1}
                onClick={(e) => {
                  e.stopPropagation();
                  setTrainVariants([...ALL_TRAIN_VARIANTS]);
                  persistCardFilters({ trainVariants: [...ALL_TRAIN_VARIANTS] });
                  startTrainingSession(trainStatus, trainFilter, [...ALL_TRAIN_VARIANTS], trainBook, trainSourceId, drilling);
                }}
                title="Все направления вперемешку"
              >
                Всё
              </button>
            </div>
          )}

          {trainMode === "active" ? (
            <ProductiveTrainer
              cards={trainCards}
              targetLanguage={targetLanguage}
              onReviewed={(card) => onUpdateCard({ ...card, lastReviewedAt: new Date().toISOString() })}
            />
          ) : (
          <>
          {showTrainFilterPanel && (
            <FilterSheet title="Фильтры тренировки" onClose={() => setShowTrainFilterPanel(false)}>
              {/* One control for the whole question of where the cards come
                  from. It used to be a select for «only this one» with a wall
                  of chips under it for «all but these» — thirty-five chips
                  buried every other filter in the panel, and the number of
                  packs only goes up. The summary says what is set; the picker
                  behind it has a search box and a page at a time. */}
              {cardSources.length > 1 && (
                <div className="filter-group">
                  <div className="filter-group-label">Источники</div>
                  <button
                    type="button"
                    className={`srs-source-btn${narrowedToOneSource || trainExcluded.length > 0 ? " active" : ""}`}
                    onClick={() => setShowSourcePicker(true)}
                  >
                    <Layers size={15} />
                    <span className="srs-source-btn-copy">
                      <strong>{selectedSource ? selectedSource.title : "Все источники"}</strong>
                      <small>
                        {trainExcluded.length > 0
                          ? `исключено: ${trainExcluded.length}`
                          : selectedSource
                            ? `${selectedSource.cards} ${cardNoun(selectedSource.cards)}`
                            : `${cardSources.length} ${sourceNoun(cardSources.length)}`}
                      </small>
                    </span>
                    <ChevronDown size={14} />
                  </button>
                </div>
              )}

              <div className="filter-group">
                <div className="filter-group-label">Тип</div>
                <div className="filter-chips">
                  {(["all", ...LEARNING_ITEM_TYPES] as FilterType[]).map((t) => (
                    <button
                      key={t}
                      className={`filter-chip ${trainFilter === t ? "active" : ""}`}
                      onClick={() => { setTrainFilter(t); persistCardFilters({ trainFilter: t }); startTrainingSession(trainStatus, t, trainVariants); }}
                      type="button"
                    >
                      {t === "all" ? "Все типы" : TYPE_LABELS[t]}
                      {t !== "all" && (
                        <span style={{ marginLeft: 4, opacity: 0.7 }}>{trainCounts.byType[t]}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {posOptions.length > 1 && (
                <div className="filter-group">
                  <div className="filter-group-label">Часть речи</div>
                  <div className="filter-chips">
                    <button
                      className={`filter-chip ${trainPos === "all" ? "active" : ""}`}
                      onClick={() => { setTrainPos("all"); persistCardFilters({ trainPos: "all" }); startTrainingSession(trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, drilling, trainExcluded, "all"); }}
                      type="button"
                    >
                      Все
                    </button>
                    {posOptions.map(([norm, label]) => (
                      <button
                        key={norm}
                        className={`filter-chip ${trainPos === norm ? "active" : ""}`}
                        onClick={() => { setTrainPos(norm); persistCardFilters({ trainPos: norm }); startTrainingSession(trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, drilling, trainExcluded, norm); }}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="filter-group">
                <div className="filter-group-label">Статус</div>
                <div className="filter-chips">
                  {(["all", "new", "learning", "review", "relearning", "hard"] as TrainStatus[]).map((s) => {
                    const count = trainCounts.byStatus[s];
                    return (
                      <button
                        key={s}
                        className={`filter-chip ${trainStatus === s ? "active" : ""}`}
                        onClick={() => { setTrainStatus(s); persistCardFilters({ trainStatus: s }); startTrainingSession(s, trainFilter, trainVariants); }}
                        type="button"
                      >
                        {s === "all" ? "Все статусы" : TRAIN_STATUS_LABELS[s]}
                        {s !== "all" && <span style={{ marginLeft: 4, opacity: 0.7 }}>{count}</span>}
                      </button>
                    );
                  })}
                </div>
                {trainStatus === "hard" && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                    Карточки с частыми ошибками — включая не назначенные на сегодня и слова, которые не даются в тренажёрах глаголов и существительных
                  </div>
                )}
              </div>

              <div className="filter-group">
                <div className="filter-group-label">Новых слов в день</div>
                <div className="filter-chips">
                  {NEW_PER_DAY_OPTIONS.map((n) => (
                    <button
                      key={n}
                      className={`filter-chip ${newPerDay === n ? "active" : ""}`}
                      onClick={() => { setNewPerDay(n); persistCardFilters({ newPerDay: n }); }}
                      type="button"
                    >
                      {n === 0 ? "Без лимита" : n}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                  {stats.heldNewCards > 0
                    ? `Ещё ${stats.heldNewCards} новых ждут следующих дней. Пачку из словаря и «Новые» лимит не ограничивает.`
                    : "Столько незнакомых слов в день добавляет обычная тренировка. Пачку из словаря и «Новые» лимит не ограничивает."}
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-group-label">Вариант тренировки (можно выбрать несколько)</div>
                <div className="filter-chips">
                  {(["forward", "reverse", "audio"] as TrainVariant[]).map((v) => (
                    <button
                      key={v}
                      className={`filter-chip ${trainVariants.includes(v) ? "active" : ""}`}
                      onClick={() => {
                        const next = trainVariants.includes(v) ? trainVariants.filter((x) => x !== v) : [...trainVariants, v];
                        if (next.length === 0) return;
                        setTrainVariants(next);
                        persistCardFilters({ trainVariants: next });
                        startTrainingSession(trainStatus, trainFilter, next);
                      }}
                      type="button"
                    >
                      {TRAIN_VARIANT_LABELS[v]}
                    </button>
                  ))}
                </div>
              </div>

              {activeTrainFilterCount > 0 && (
                <button
                  className="filter-reset-btn"
                  onClick={() => { leaveBatchForOwnChoice(); setTrainFilter("all"); setTrainStatus("all"); setTrainBook("all"); setTrainSourceId(null); setTrainExcluded([]); setTrainVariants(DEFAULT_TRAIN_VARIANTS); setTrainPos("all"); persistCardFilters({ trainFilter: "all", trainStatus: "all", trainBook: "all", trainSourceId: null, trainExcluded: [], trainVariants: DEFAULT_TRAIN_VARIANTS, trainPos: "all" }); startTrainingSession("all", "all", DEFAULT_TRAIN_VARIANTS, "all", null, false, [], "all"); }}
                  type="button"
                >
                  Сбросить фильтры
                </button>
              )}
            </FilterSheet>
          )}

          {trainQueue.length === 0 ? (
            dueCards.length === 0 && trainStatus !== "hard" ? (
              <div className="empty-state">
                <CheckCircle2 size={44} style={{ color: "var(--green)" }} />
                <strong>Нечего повторять!</strong>
                <p>
                  {drillCandidates > 0
                    ? "По расписанию на сегодня всё сделано. Но пройти этот набор ещё раз можно когда угодно — на расписание это не влияет."
                    : "Нет карточек для тренировки. Добавьте новые слова во время чтения."}
                </p>
                {drillCandidates > 0 && (
                  <button className="primary-btn" style={{ marginTop: 12, maxWidth: 280 }} onClick={drillAgain} type="button">
                    <RotateCcw size={14} style={{ marginRight: 6 }} /> Пройти заново ({drillCandidates})
                  </button>
                )}
                {/* Said out loud, because an exclusion made a while ago is
                    exactly the thing a learner will not think to look for when
                    the queue turns up empty. */}
                {trainExcluded.length > 0 && (
                  <button className="secondary-btn" style={{ marginTop: 12 }} onClick={() => setExcludedSources([])} type="button">
                    <EyeOff size={14} /> Исключено источников: {trainExcluded.length} — вернуть
                  </button>
                )}
              </div>
            ) : (
              <div className="empty-state">
                <AlertCircle size={40} />
                <strong>{dueElsewhere > 0 ? "В этом направлении на сегодня всё" : drillCandidates > 0 ? "На сегодня по расписанию ничего нет" : "Нет карточек по выбранным фильтрам"}</strong>
                {trainStatus === "hard" && <p>Отлично — сложных карточек нет!</p>}
                {/* The way out of the dead end the learner actually hit:
                    everything in this selection is scheduled for later, and
                    they want to go through it now anyway. */}
                {dueElsewhere > 0 && (
                  <button className="primary-btn" style={{ marginTop: 12, maxWidth: 280 }} onClick={trainAllDirections} type="button">
                    <Play size={14} fill="currentColor" style={{ marginRight: 6 }} /> Ещё {dueElsewhere} — все направления
                  </button>
                )}
                {drillCandidates > 0 && (
                  <button className={dueElsewhere > 0 ? "secondary-btn" : "primary-btn"} style={{ marginTop: 12, maxWidth: 280 }} onClick={drillAgain} type="button">
                    <RotateCcw size={14} style={{ marginRight: 6 }} /> Пройти заново ({drillCandidates})
                  </button>
                )}
              </div>
            )
          ) : historyPosition && historyCard && historyItem ? (
            <div className="srs-history-view">
              <div className="srs-history-banner">
                <Eye size={17} />
                <div className="srs-history-banner-copy">
                  <strong>Просмотр пройденной карточки</strong>
                  <span>Не влияет на прогресс и расписание повторений</span>
                </div>
                <button className="srs-history-close" type="button" aria-label="Вернуться к обучению" onClick={closeReviewedCard}>
                  <X size={17} />
                </button>
              </div>

              <article className="srs-history-card">
                <div className="srs-history-card-head">
                  <span className="srs-history-direction">{TRAIN_VARIANT_LABELS[historyItem.variant]}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 750 }}>
                    {historyPosition.index + 1} из {reviewHistory.length}
                  </span>
                </div>

                <div className="srs-history-word-row">
                  <div className="srs-history-word">
                    <TokenizedText text={historyCard.front} style={{ fontSize: "inherit", fontWeight: "inherit", lineHeight: "inherit" }} onWordTap={handleHistoryWordTap} />
                  </div>
                  <SpeakButton text={historyCard.front} lang={targetLanguage} size={19} />
                  <button
                    className="srs-history-close"
                    type="button"
                    aria-label="Проверить и исправить карточку"
                    title="Проверить и исправить карточку"
                    onClick={() => setFixCard(historyCard)}
                  >
                    <ShieldCheck size={17} />
                  </button>
                </div>
                <div className="srs-history-divider" />
                <div className="srs-history-label">Перевод</div>
                <div className="srs-history-meaning">{historyBackParts.meaning || "—"}</div>
                {historyVerb.summary && <CardVerbForms summary={historyVerb.summary} />}
                {historyVerb.details && <div className="srs-history-details">{historyVerb.details}</div>}
                <div className="srs-history-source">{historyCard.sourceBookTitle || historyCard.source}</div>
              </article>

              <div className="srs-history-nav">
                <button
                  className="srs-history-nav-btn"
                  type="button"
                  disabled={!historyPosition.canGoOlder}
                  onClick={() => setViewingHistoryIndex(historyPosition.index - 1)}
                >
                  <ChevronLeft size={16} /> Предыдущая
                </button>
                <button
                  className="srs-history-nav-btn"
                  type="button"
                  onClick={() => historyPosition.canGoNewer
                    ? setViewingHistoryIndex(historyPosition.index + 1)
                    : closeReviewedCard()}
                >
                  {historyPosition.canGoNewer ? "Следующая" : "К обучению"} <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ) : currentTrainIndex >= trainQueue.length ? (
            <div className="empty-state" style={{ background: "linear-gradient(135deg, rgba(122, 171, 106, 0.08) 0%, var(--bg-elevated) 100%)", borderColor: "rgba(122, 171, 106, 0.2)" }}>
              <CheckCircle2 size={48} style={{ color: "var(--green)" }} />
              <strong>{batch ? "Пачка пройдена!" : "Тренировка завершена!"}</strong>
              <p>
                {batch
                  ? `«${batch.title}» — все ${trainQueue.length} повторений сделаны. Отличная работа!`
                  : `Вы повторили все ${trainQueue.length} карточек. Отличная работа!`}
              </p>
              {/* The batch was a detour. Its cards are done, so the obvious next
                  step is the training the learner set up for themselves — which
                  is still exactly as they left it. */}
              {dueElsewhere > 0 && (
                  <button className="primary-btn" style={{ marginTop: 12, maxWidth: 280 }} onClick={trainAllDirections} type="button">
                    <Play size={14} fill="currentColor" style={{ marginRight: 6 }} /> Ещё {dueElsewhere} — все направления
                  </button>
                )}
                {batch && (
                <button className="primary-btn" style={{ marginTop: 12, maxWidth: 280 }} onClick={startSavedTraining} type="button">
                  <Play size={14} fill="currentColor" style={{ marginRight: 6 }} /> Продолжить обычную тренировку
                </button>
              )}
              <button className="secondary-btn" style={{ marginTop: 12 }} onClick={drillAgain} type="button">
                <RotateCcw size={14} /> {batch ? "Пройти пачку заново" : "Начать заново"}
              </button>
              {/* Which is the point of a first pass: the same material, in the
                  other direction, straight away. */}
              <div className="srs-dir-row" style={{ marginTop: 12 }}>
                {ALL_TRAIN_VARIANTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`srs-dir-chip${trainVariants.length === 1 && trainVariants[0] === v ? " active" : ""}`}
                    onClick={() => switchDirection(v)}
                    title={`Пройти заново: ${TRAIN_VARIANT_LABELS[v]}`}
                  >
                    {VARIANT_SHORT_LABELS[v]}
                  </button>
                ))}
              </div>
              {reviewHistory.length > 0 && (
                <button className="srs-history-open" onClick={openLatestReviewedCard} type="button">
                  <Eye size={15} />
                  <span className="srs-history-open-copy">
                    <strong>Посмотреть последнюю карточку</strong>
                    <small>без изменения прогресса</small>
                  </span>
                </button>
              )}
            </div>
          ) : (
            <div className="srs-train-stage" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* In zen, the whole of the surrounding page is reduced to this:
                  where you are in the queue, and the way out. */}
              {zenActive && (
                <div className="zen-topbar">
                  <span className="zen-count">{currentTrainIndex + 1} / {trainQueue.length}</span>
                  <div className="zen-progress" role="progressbar" aria-valuenow={Math.round((currentTrainIndex / trainQueue.length) * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${Math.round((currentTrainIndex / trainQueue.length) * 100)}%` }} />
                  </div>
                  <button className="zen-topbar-btn" onClick={(e) => { e.stopPropagation(); setZen(false); }} type="button" aria-label="Выйти из дзен-режима" title="Выйти из дзен-режима (Esc)">
                    <Minimize2 size={17} />
                  </button>
                </div>
              )}

              {/* Progress */}
              <div className="srs-train-progress" style={{ width: "100%", maxWidth: 420, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>
                <span>Карточка {currentTrainIndex + 1} из {trainQueue.length}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--accent)" }}>{Math.round((currentTrainIndex / trainQueue.length) * 100)}% пройдено</span>
                  {/* The way in, sat directly above the card it clears the
                      screen for. Deliberately not automatic: the page around
                      the card is where a session is set up, and it should still
                      be there when that is what the learner came for. */}
                  <button
                    className="zen-toggle"
                    onClick={(e) => { e.stopPropagation(); setZen(true); }}
                    type="button"
                    aria-label="Дзен-режим"
                    title="Дзен-режим — только карточка и оценки"
                  >
                    <Maximize2 size={15} />
                  </button>
                </span>
              </div>

              {cardFlipper}

              {/* Grade buttons — always available. Keys 4 · 5 · 6. */}
              <div className="srs-grade-row">
                {([
                  [1, "Забыл", "grade-btn-1"],
                  [3, "Помню", "grade-btn-3"],
                  [4, "Легко", "grade-btn-4"],
                ] as const).map(([grade, label, cls]) => (
                  <button key={grade} className={`grade-btn ${cls}`} onClick={() => handleGrade(grade)} type="button">
                    {label}
                  </button>
                ))}
              </div>
              {reviewHistory.length > 0 && (
                <button className="srs-history-open" onClick={openLatestReviewedCard} type="button">
                  <Eye size={15} />
                  <span className="srs-history-open-copy">
                    <strong>Посмотреть предыдущую карточку</strong>
                    <small>без изменения прогресса</small>
                  </span>
                </button>
              )}

              {/* Only where there is a keyboard to press. On a touch screen a
                  list of keys would be instructions for something that does not
                  exist — and even on a desktop it is read once, so it is a line
                  rather than a wall under the card. */}
              <button
                type="button"
                className="srs-keys-link"
                onClick={(e) => { e.stopPropagation(); setShowKeysModal(true); }}
              >
                <Keyboard size={12} /> Горячие клавиши
              </button>
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* TAB: ALL CARDS */}
      {activeTab === "all" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <div className="all-toolbar">
            <div className="all-search-bar">
              <Search size={18} className="text-muted" />
              <input
                className="all-search-input"
                placeholder="Поиск по карточкам..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(50); }}
                type="text"
              />
              {searchQuery && (
                <button style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontWeight: "bold" }} onClick={() => setSearchQuery("")} type="button">✕</button>
              )}
            </div>
            <button
              className={`all-filter-toggle ${showFilterPanel ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setShowFilterPanel((v) => !v); }}
              type="button"
            >
              <SlidersHorizontal size={15} /> Фильтры
              {activeFilterCount > 0 && <span className="all-filter-count">{activeFilterCount}</span>}
              <ChevronDown size={12} />
            </button>
          </div>

          {showFilterPanel && (
            <FilterSheet title="Фильтры списка" onClose={() => setShowFilterPanel(false)}>
              <div className="filter-group">
                <div className="filter-group-label">Статус</div>
                <div className="filter-chips">
                  {(["all", "new", "learning", "review", "relearning"] as FilterStatus[]).map((s) => (
                    <button key={s} className={`filter-chip ${filterStatus === s ? "active" : ""}`} onClick={() => { setFilterStatus(s); persistCardFilters({ filterStatus: s }); setVisibleCount(50); }} type="button">
                      {s === "all" ? "Все" : STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-group-label">Тип</div>
                <div className="filter-chips">
                  {(["all", ...LEARNING_ITEM_TYPES] as FilterType[]).map((t) => (
                    <button key={t} className={`filter-chip ${filterType === t ? "active" : ""}`} onClick={() => { setFilterType(t); persistCardFilters({ filterType: t }); setVisibleCount(50); }} type="button">
                      {t === "all" ? "Все типы" : TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-group-label">Уровень CEFR</div>
                <div className="filter-chips">
                  <button aria-pressed={excludedLevels.length === 0} className={`filter-chip ${excludedLevels.length === 0 ? "active" : ""}`} onClick={() => updateLevelFilter([])} type="button">Все</button>
                  {cardLevels.map((l) => (
                    <button aria-pressed={!excludedLevels.includes(l)} key={l} className={`filter-chip ${!excludedLevels.includes(l) ? "active" : ""}`} onClick={() => {
                      const nextLevels = excludedLevels.includes(l)
                        ? excludedLevels.filter((level) => level !== l)
                        : [...excludedLevels, l];
                      updateLevelFilter(nextLevels);
                    }} type="button">
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {posOptions.length > 1 && (
                <div className="filter-group">
                  <div className="filter-group-label">Часть речи</div>
                  <div className="filter-chips">
                    <button className={`filter-chip ${filterPos === "all" ? "active" : ""}`} onClick={() => { setFilterPos("all"); persistCardFilters({ filterPos: "all" }); setVisibleCount(50); }} type="button">Все</button>
                    {posOptions.map(([norm, label]) => (
                      <button key={norm} className={`filter-chip ${filterPos === norm ? "active" : ""}`} onClick={() => { setFilterPos(norm); persistCardFilters({ filterPos: norm }); setVisibleCount(50); }} type="button">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {allBooks.length > 1 && (
                <div className="filter-group">
                  <div className="filter-group-label">Книга</div>
                  <select className="book-select" value={filterBook} onChange={(e) => { setFilterBook(e.target.value); persistCardFilters({ filterBook: e.target.value }); setVisibleCount(50); }}>
                    <option value="all">Все книги</option>
                    {allBooks.map((b) => <option key={b} value={b}>{b.length > 20 ? b.slice(0, 20) + "…" : b}</option>)}
                  </select>
                </div>
              )}

              <div className="filter-group">
                <div className="filter-group-label">Сортировка</div>
                <div className="filter-chips">
                  {([["added", "По дате добавления"], ["due", "По дате повторения"], ["ease", "По лёгкости"]] as [SortOrder, string][]).map(([val, lbl]) => (
                    <button key={val} className={`filter-chip ${sortOrder === val ? "active" : ""}`} onClick={() => { setSortOrder(val); persistCardFilters({ sortOrder: val }); }} type="button">{lbl}</button>
                  ))}
                </div>
              </div>

              {activeFilterCount > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                  <button className="filter-reset-btn" onClick={() => { setFilterStatus("all"); setFilterType("all"); setFilterBook("all"); updateLevelFilter([]); setFilterPos("all"); persistCardFilters({ filterStatus: "all", filterType: "all", filterBook: "all", filterPos: "all" }); setVisibleCount(50); }} type="button">
                    Сбросить фильтры
                  </button>
                  {filteredAllCards.length > 0 && (
                    <button
                      className="filter-reset-btn"
                      onClick={deleteFilteredCards}
                      type="button"
                      style={{ color: "#e08888", borderColor: "rgba(224, 136, 136, 0.35)" }}
                    >
                      <Trash2 size={14} /> Удалить все {filteredAllCards.length} {cardNoun(filteredAllCards.length)} по фильтру
                    </button>
                  )}
                </div>
              )}
            </FilterSheet>
          )}

          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, marginBottom: 8 }}>
            {filteredAllCards.length} карточек
          </div>

          {filteredAllCards.length === 0 ? (
            <div className="empty-state">
              <AlertCircle size={40} />
              <strong>Карточки не найдены</strong>
              <p>{searchQuery ? "Попробуйте изменить запрос." : "Словарь пуст. Добавьте карточки во время чтения."}</p>
            </div>
          ) : (
            <div className="card-list">
              {visibleCards.map((card) => (
                <AllCardRow
                  key={card.id}
                  card={card}
                  facts={wordFacts.get(normalizeFront(card.front))}
                  targetLanguage={targetLanguage}
                  onWordTap={handleWordTap}
                  onDiscuss={openDiscussCallback}
                  onFix={openFixCallback}
                  onDelete={onDeleteCard}
                  leech={leechCardIds.has(card.id)}
                />
              ))}
              {hasMoreRows && <div ref={sentinelRef} style={{ height: 1 }} />}
            </div>
          )}
        </div>
      )}

      </>)}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}
