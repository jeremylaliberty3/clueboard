-- Clueboard Phase A schema.
-- Paste this whole file into the Supabase SQL Editor and click "Run".
-- Safe to re-run (uses IF NOT EXISTS / DROP POLICY guards).

-- ============================================================
-- Tables
-- ============================================================

create table if not exists clues (
  id            bigserial primary key,
  category      text not null,
  category_tag  text,
  clue          text not null,
  answer        text not null,
  value         int,
  round         text not null check (round in ('single', 'final')),
  air_date      date,
  show_number   int,
  created_at    timestamptz not null default now()
);

create index if not exists clues_round_value_idx on clues (round, value);
create index if not exists clues_category_idx    on clues (category);
create index if not exists clues_air_date_idx    on clues (air_date);

-- daily_boards: one row per US/Eastern calendar date.
-- categories[]  = the 6 chosen category names (in display order)
-- clue_ids[]    = 30 single-round clue ids (6 categories × 5 values)
-- final_clue_id = the Final Clue id
create table if not exists daily_boards (
  date           date primary key,
  categories     text[] not null,
  clue_ids       bigint[] not null,
  final_clue_id  bigint not null references clues(id),
  seed           bigint not null,
  created_at     timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
-- Both tables are public-read so anonymous users can play.
-- Writes are restricted to the service_role (used only by the
-- import script and any server-side board-generation logic).

alter table clues          enable row level security;
alter table daily_boards   enable row level security;

drop policy if exists "clues are publicly readable"          on clues;
drop policy if exists "daily_boards are publicly readable"   on daily_boards;

create policy "clues are publicly readable"
  on clues for select
  to anon, authenticated
  using (true);

create policy "daily_boards are publicly readable"
  on daily_boards for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policies for anon or authenticated, so writes
-- require the service_role key (which bypasses RLS).
