CREATE TABLE public.session_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  seed_prompt text NOT NULL DEFAULT '',
  first_song text NOT NULL DEFAULT '',
  played_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  resume_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, session_id)
);
CREATE INDEX session_log_user_recent ON public.session_log (user_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_log TO authenticated;
GRANT ALL ON public.session_log TO service_role;
ALTER TABLE public.session_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own session log select" ON public.session_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own session log insert" ON public.session_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own session log update" ON public.session_log FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own session log delete" ON public.session_log FOR DELETE TO authenticated USING (auth.uid() = user_id);