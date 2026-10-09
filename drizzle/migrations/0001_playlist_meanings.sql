CREATE TABLE public.playlist_meanings (
  user_id uuid NOT NULL,
  playlist_name text NOT NULL,
  meaning text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, playlist_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlist_meanings TO authenticated;
GRANT ALL ON public.playlist_meanings TO service_role;
ALTER TABLE public.playlist_meanings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own playlist meanings" ON public.playlist_meanings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);