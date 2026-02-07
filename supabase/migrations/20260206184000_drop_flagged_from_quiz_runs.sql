-- Drop flagged column from quiz_runs
ALTER TABLE IF EXISTS public.quiz_runs
  DROP COLUMN IF EXISTS flagged;
