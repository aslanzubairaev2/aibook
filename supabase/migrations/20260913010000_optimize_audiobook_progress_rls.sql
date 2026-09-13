-- Keep the RLS identity lookup initplanned once per statement, not once per row.
drop policy if exists "Users can read their audiobook progress" on public.audiobook_progress;
create policy "Users can read their audiobook progress"
  on public.audiobook_progress for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their audiobook progress" on public.audiobook_progress;
create policy "Users can insert their audiobook progress"
  on public.audiobook_progress for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their audiobook progress" on public.audiobook_progress;
create policy "Users can update their audiobook progress"
  on public.audiobook_progress for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their audiobook progress" on public.audiobook_progress;
create policy "Users can delete their audiobook progress"
  on public.audiobook_progress for delete using ((select auth.uid()) = user_id);
