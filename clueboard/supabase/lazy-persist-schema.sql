-- Phase: lazy-persist daily boards.
-- Adds a Daily Double column to daily_boards, plus a SECURITY DEFINER
-- function the app can call to write a board row from server actions
-- without needing the service_role key in Vercel env.
-- Safe to re-run.

-- ============================================================
-- Column add
-- ============================================================

alter table daily_boards
  add column if not exists daily_double_clue_id bigint references clues(id);

-- ============================================================
-- persist_daily_board(): SECURITY DEFINER so callers (anon/auth) can
-- write a board for a date that has no row yet, but can NEVER overwrite
-- an existing row (the on-conflict-do-nothing guarantees a date's board
-- is frozen the moment it's first generated).
-- ============================================================

create or replace function public.persist_daily_board(
  p_date                  date,
  p_categories            text[],
  p_clue_ids              bigint[],
  p_final_clue_id         bigint,
  p_daily_double_clue_id  bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into daily_boards
    (date, categories, clue_ids, final_clue_id, daily_double_clue_id, seed)
  values
    (
      p_date,
      p_categories,
      p_clue_ids,
      p_final_clue_id,
      p_daily_double_clue_id,
      cast(replace(p_date::text, '-', '') as bigint)
    )
  on conflict (date) do nothing;
end;
$$;

grant execute on function public.persist_daily_board to anon, authenticated;
