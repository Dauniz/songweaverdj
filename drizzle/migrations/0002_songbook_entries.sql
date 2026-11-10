CREATE TABLE public.songbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  resume_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.songbook_entries TO authenticated;
GRANT ALL ON public.songbook_entries TO service_role;
ALTER TABLE public.songbook_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own songbook" ON public.songbook_entries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX songbook_entries_user_idx ON public.songbook_entries(user_id, updated_at DESC);