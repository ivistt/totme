-- ═══════════════════════════════════════════════════════════
-- ОБЛІК ПРОЄКТІВ — SQL для Supabase (з авторизацією)
-- Виконати в Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ── ТАБЛИЦЯ ПРОЄКТІВ ────────────────────────────────────────
create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  rate          numeric(10,2) default 0,
  hours         numeric(10,2) default 0,
  static_amount numeric(10,2) default 0,
  paid          boolean default false,
  created_at    timestamptz default now()
);

-- ── ТАБЛИЦЯ ЩОДЕННИКА ───────────────────────────────────────
create table if not exists journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  date       date not null,
  comment    text not null default '',
  created_at timestamptz default now(),
  unique(project_id, date)
);

-- ── RLS: УВІМКНУТИ ──────────────────────────────────────────
alter table projects        enable row level security;
alter table journal_entries enable row level security;

-- ── ВИДАЛИТИ СТАРІ ПОЛІТИКИ (якщо були) ─────────────────────
drop policy if exists "select own projects"  on projects;
drop policy if exists "insert own projects"  on projects;
drop policy if exists "update own projects"  on projects;
drop policy if exists "delete own projects"  on projects;
drop policy if exists "allow all projects"   on projects;

drop policy if exists "select own entries"   on journal_entries;
drop policy if exists "insert own entries"   on journal_entries;
drop policy if exists "update own entries"   on journal_entries;
drop policy if exists "delete own entries"   on journal_entries;
drop policy if exists "allow all entries"    on journal_entries;

-- ── RLS POLICIES: projects (через auth.uid()) ────────────────
create policy "projects: select own"
  on projects for select
  using (user_id = auth.uid());

create policy "projects: insert own"
  on projects for insert
  with check (user_id = auth.uid());

create policy "projects: update own"
  on projects for update
  using (user_id = auth.uid());

create policy "projects: delete own"
  on projects for delete
  using (user_id = auth.uid());

-- ── RLS POLICIES: journal_entries (через auth.uid()) ─────────
create policy "entries: select own"
  on journal_entries for select
  using (user_id = auth.uid());

create policy "entries: insert own"
  on journal_entries for insert
  with check (user_id = auth.uid());

create policy "entries: update own"
  on journal_entries for update
  using (user_id = auth.uid());

create policy "entries: delete own"
  on journal_entries for delete
  using (user_id = auth.uid());
