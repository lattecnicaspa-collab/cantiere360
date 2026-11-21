-- Cantiere360: dati condivisi tra gli utenti dell'app (registrazioni chiuse)
alter table public.kv drop constraint kv_pkey;
alter table public.kv add primary key (col, id);
drop policy if exists kv_own on public.kv;
drop policy if exists kv_team on public.kv;
create policy kv_team on public.kv for all to authenticated
  using (true) with check (true);
alter table public.kv alter column owner drop not null;
alter table public.kv drop constraint if exists kv_owner_fkey;
alter table public.kv add constraint kv_owner_fkey foreign key (owner) references auth.users(id) on delete set null;
drop policy if exists files_own_read on storage.objects;
drop policy if exists files_own_insert on storage.objects;
drop policy if exists files_own_update on storage.objects;
drop policy if exists files_own_delete on storage.objects;
drop policy if exists files_team_read on storage.objects;
drop policy if exists files_team_insert on storage.objects;
drop policy if exists files_team_update on storage.objects;
drop policy if exists files_team_delete on storage.objects;
create policy files_team_read on storage.objects for select to authenticated using (bucket_id = 'files');
create policy files_team_insert on storage.objects for insert to authenticated with check (bucket_id = 'files');
create policy files_team_update on storage.objects for update to authenticated using (bucket_id = 'files');
create policy files_team_delete on storage.objects for delete to authenticated using (bucket_id = 'files');
