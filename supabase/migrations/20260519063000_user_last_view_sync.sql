alter table public.user_settings
  add column if not exists last_section text not null default 'home'
  check (last_section in ('home', 'discover', 'books', 'reader', 'cards', 'settings'));

alter table public.user_settings
  add column if not exists last_book_id uuid references public.books(id) on delete set null;

alter table public.user_settings
  add column if not exists last_view_updated_at timestamptz not null default now();
