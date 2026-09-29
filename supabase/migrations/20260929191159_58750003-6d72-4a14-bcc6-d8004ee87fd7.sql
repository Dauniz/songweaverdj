ALTER TABLE public.bug_reports ADD COLUMN IF NOT EXISTS email TEXT;
UPDATE public.bug_reports br SET email = u.email FROM auth.users u WHERE br.user_id = u.id AND br.email IS NULL;