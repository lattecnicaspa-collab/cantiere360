-- Cantiere360: tabelle, regole di sicurezza e spazio file
create table if not exists public.kv (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  col text not null,
  id text not null,
  data jsonb not null,
  board_id text generated always as (data->>'boardId') stored,
  updated_at timestamptz not null default now(),
  primary key (owner, col, id)
);
create index if not exists kv_owner_col_board on public.kv (owner, col, board_id);
alter table public.kv enable row level security;
alter table public.kv replica identity full;
grant select, insert, update, delete on public.kv to authenticated;
revoke all on public.kv from anon;
drop policy if exists kv_own on public.kv;
create policy kv_own on public.kv for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.kv;
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;
drop policy if exists files_own_read on storage.objects;
drop policy if exists files_own_insert on storage.objects;
drop policy if exists files_own_update on storage.objects;
drop policy if exists files_own_delete on storage.objects;
create policy files_own_read on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy files_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy files_own_update on storage.objects for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy files_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
