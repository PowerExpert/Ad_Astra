-- Ad Astra — accounts + per-project isolation migration
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is guarded with IF NOT EXISTS / DROP-then-CREATE.

-- ── 1. Projects table (the registry the hub reads/writes) ───────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled Project',
  color text default '#6F00FF',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

-- ── 2. project_id column on every existing data table ────────────────────
-- Nullable: NULL means "the legacy single-vault project" (storage.js's
-- 'default' id), so existing rows from before this migration keep working
-- without needing to be backfilled.
alter table public.notes          add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.note_links     add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.graph_objects  add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.materials      add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.tests          add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.test_attempts  add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.flashcards     add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.user_settings  add column if not exists project_id uuid references public.projects(id) on delete cascade;

-- Helpful indexes for the per-project filtering storage.js now does on
-- every load.
create index if not exists idx_notes_project         on public.notes (user_id, project_id);
create index if not exists idx_note_links_project     on public.note_links (user_id, project_id);
create index if not exists idx_graph_objects_project  on public.graph_objects (user_id, project_id);
create index if not exists idx_materials_project      on public.materials (user_id, project_id);
create index if not exists idx_tests_project          on public.tests (user_id, project_id);
create index if not exists idx_test_attempts_project  on public.test_attempts (user_id, project_id);
create index if not exists idx_flashcards_project     on public.flashcards (user_id, project_id);

-- ── 3. user_settings: one row per (user, project), not just per user ────
-- storage.js upserts settings with onConflict: 'user_id,project_id', so
-- that needs to be a real unique constraint (replacing a user_id-only one
-- if you had that before).
alter table public.user_settings drop constraint if exists user_settings_user_id_key;
alter table public.user_settings add constraint user_settings_user_id_project_id_key unique (user_id, project_id);

-- ── 4. (Existing RLS policies on notes/note_links/etc. that check
--        auth.uid() = user_id keep working unchanged — project_id is an
--        additional filter the app applies client-side on top of that
--        security boundary, not a replacement for it.)
