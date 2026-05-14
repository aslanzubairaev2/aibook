insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'books',
  'books',
  false,
  52428800,
  array[
    'text/plain',
    'application/epub+zip',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users read own book files" on storage.objects
  for select using (
    bucket_id = 'books'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users upload own book files" on storage.objects
  for insert with check (
    bucket_id = 'books'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users update own book files" on storage.objects
  for update using (
    bucket_id = 'books'
    and auth.uid()::text = (storage.foldername(name))[1]
  ) with check (
    bucket_id = 'books'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users delete own book files" on storage.objects
  for delete using (
    bucket_id = 'books'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
