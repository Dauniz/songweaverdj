CREATE TABLE public.listening_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id uuid REFERENCES public.library_tracks(id) ON DELETE SET NULL,
  track_name text,
  artists text,
  event text NOT NULL CHECK (event IN ('play_through','early_skip','replay','explicit_fav','explicit_skip')),
  session_id text,
  mode text CHECK (mode IN ('era','vibe')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.listening_events TO authenticated;
GRANT ALL ON public.listening_events TO service_role;
ALTER TABLE public.listening_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own listening events" ON public.listening_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX listening_events_user_idx ON public.listening_events (user_id, created_at DESC);