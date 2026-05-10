-- Clueboard Phase B schema: profiles + game_sessions.
-- Paste into Supabase SQL Editor and click Run. Safe to re-run.

-- ============================================================
-- profiles — extension of auth.users with display info
-- ============================================================

create table if not exists profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- game_sessions — one row per (user, day)
-- ============================================================

create table if not exists game_sessions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  date                 date not null,
  state                jsonb not null default '{}'::jsonb,
  final_wager          int,
  final_answer         text,
  final_correct        boolean,
  final_score          int,
  status               text not null default 'in_progress'
                       check (status in ('in_progress', 'completed')),
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  unique (user_id, date)
);

create index if not exists game_sessions_user_id_idx
  on game_sessions (user_id);
create index if not exists game_sessions_user_date_idx
  on game_sessions (user_id, date desc);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table profiles      enable row level security;
alter table game_sessions enable row level security;

-- profiles: a user can read and update only their own row.
drop policy if exists "profiles: read own"   on profiles;
drop policy if exists "profiles: update own" on profiles;

create policy "profiles: read own"
  on profiles for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles: update own"
  on profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- game_sessions: a user can do anything to their own rows; nothing on
-- anyone else's. The trigger creates rows automatically; users can
-- also update their state (the server action validates content).
drop policy if exists "game_sessions: read own"   on game_sessions;
drop policy if exists "game_sessions: insert own" on game_sessions;
drop policy if exists "game_sessions: update own" on game_sessions;

create policy "game_sessions: read own"
  on game_sessions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "game_sessions: insert own"
  on game_sessions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "game_sessions: update own"
  on game_sessions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
