alter table public.user_settings
  add column if not exists last_section text not null default 'home';

alter table public.user_settings
  add column if not exists last_book_id uuid references public.books(id) on delete set null;

alter table public.user_settings
  add column if not exists last_view_updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_last_section_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_last_section_check
      check (last_section in ('home', 'discover', 'books', 'reader', 'cards', 'settings'));
  end if;
end $$;

notify pgrst, 'reload schema';
