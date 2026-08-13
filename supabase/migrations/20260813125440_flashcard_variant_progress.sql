-- Independent SRS schedules for the reverse and audio variants of a card.
-- The forward schedule remains on flashcards for backwards compatibility.
CREATE TABLE public.flashcard_variant_progress (
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flashcard_id     uuid        NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  variant          text        NOT NULL CHECK (variant IN ('reverse', 'audio')),
  status           text        NOT NULL DEFAULT 'new'
                               CHECK (status IN ('new', 'learning', 'review', 'relearning')),
  repetitions      integer     NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  lapses           integer     NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  interval_days    integer     NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  easiness_factor  double precision NOT NULL DEFAULT 2.5 CHECK (easiness_factor > 0),
  next_review_at   timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, flashcard_id, variant)
);

CREATE INDEX flashcard_variant_progress_card_idx
  ON public.flashcard_variant_progress(flashcard_id);

ALTER TABLE public.flashcard_variant_progress ENABLE ROW LEVEL SECURITY;

-- Data API exposure is explicit because new Supabase projects no longer grant
-- public-schema tables automatically.
REVOKE ALL ON TABLE public.flashcard_variant_progress FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.flashcard_variant_progress TO authenticated;
GRANT ALL ON TABLE public.flashcard_variant_progress TO service_role;

CREATE POLICY "Read own flashcard variant progress"
  ON public.flashcard_variant_progress FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Insert own flashcard variant progress"
  ON public.flashcard_variant_progress FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.flashcards
      WHERE flashcards.id = flashcard_variant_progress.flashcard_id
        AND flashcards.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Update own flashcard variant progress"
  ON public.flashcard_variant_progress FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.flashcards
      WHERE flashcards.id = flashcard_variant_progress.flashcard_id
        AND flashcards.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Delete own flashcard variant progress"
  ON public.flashcard_variant_progress FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
