-- Allow 'auth' section and decouple last_book_id from the books FK so that
-- shared-library lessons (stored in shared_books, not books) can be remembered
-- as the user's last view without raising 409 conflicts.

-- 1. Drop the FK on last_book_id (shared lessons live in shared_books, not books).
do $$
declare
  fk_name text;
begin
  select conname into fk_name
  from pg_constraint
  where conrelid = 'public.user_settings'::regclass
    and contype = 'f'
    and conkey = array[
      (select attnum from pg_attribute
       where attrelid = 'public.user_settings'::regclass and attname = 'last_book_id')
    ];
  if fk_name is not null then
    execute format('alter table public.user_settings drop constraint %I', fk_name);
  end if;
end $$;

-- 2. Widen the last_section check constraint to include 'auth'.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'user_settings_last_section_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings drop constraint user_settings_last_section_check;
  end if;

  alter table public.user_settings
    add constraint user_settings_last_section_check
    check (last_section in ('home', 'discover', 'books', 'reader', 'cards', 'settings', 'auth'));
end $$;

notify pgrst, 'reload schema';
