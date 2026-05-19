alter table public.reading_progress add column if not exists paragraph_index integer not null default 0;
alter table public.reading_progress add column if not exists char_offset integer not null default 0;
alter table public.reading_progress add column if not exists selection_state jsonb;

notify pgrst, 'reload schema';
