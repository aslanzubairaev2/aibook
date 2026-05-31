-- Добавляем поддержку уровней сложности CEFR и типов источников книг/текстов
alter table public.books 
  add column if not exists cefr_level text check (cefr_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  add column if not exists source_type text default 'upload' check (source_type in ('upload', 'gutenberg', 'standard_ebooks', 'wikibooks', 'oersi', 'universal_cefr'));

-- Добавляем индекс по уровню сложности для ускорения фильтрации
create index if not exists books_cefr_level_idx on public.books(cefr_level);
create index if not exists books_source_type_idx on public.books(source_type);
