-- Phase: dataset polish + board variety rules.
-- Adds metadata columns the daily board generator uses to enforce variety.
-- Paste into Supabase SQL Editor and click Run. Safe to re-run.

-- ============================================================
-- New columns on clues
-- ============================================================

alter table clues
  add column if not exists topic text,
  add column if not exists category_style text
    check (category_style is null or category_style in ('knowledge', 'wordplay', 'themed')),
  add column if not exists difficulty_profile text
    check (difficulty_profile is null or difficulty_profile in ('easy_leaning', 'balanced', 'hard_leaning'));

create index if not exists clues_topic_idx          on clues (topic);
create index if not exists clues_style_idx          on clues (category_style);
create index if not exists clues_topic_round_idx    on clues (topic, round);

-- ============================================================
-- Wipe existing clues to make room for the new bank.
-- Skip this block if you want to keep the old data.
-- ============================================================

truncate table clues restart identity cascade;
