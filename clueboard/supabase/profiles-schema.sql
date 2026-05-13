-- Profiles: user-chosen handle/username, separate from auth identity.
-- Run AFTER the auth.users wipe so we don't leave orphan profile rows.
--
-- This script DROPS any existing `profiles` table. It's safe to run
-- because we have no production profile data yet. If you ever do, write
-- an ALTER migration instead.

create extension if not exists citext;

-- The old auth-schema.sql installed a trigger that auto-created a
-- profile row with a `display_name` column. We now handle profile
-- creation in app code (so the user can pick their own username), so
-- the trigger has to go before we recreate the table.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists profiles cascade;

create table profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   citext not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format
    check (username ~ '^[A-Za-z][A-Za-z0-9_]{2,19}$')
);

create index profiles_username_idx on profiles (username);

alter table profiles enable row level security;

-- Anyone (even anon) can read usernames — needed for leaderboards / share
-- grids later. We don't expose email or auth state through this table.
drop policy if exists "profiles are publicly readable" on profiles;
create policy "profiles are publicly readable"
  on profiles for select
  using (true);

drop policy if exists "users can insert their own profile" on profiles;
create policy "users can insert their own profile"
  on profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own profile" on profiles;
create policy "users can update their own profile"
  on profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
