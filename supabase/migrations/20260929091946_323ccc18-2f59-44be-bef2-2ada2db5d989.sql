CREATE TABLE public.listening_history (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spotify_id text NOT NULL,
  plays integer NOT NULL DEFAULT 0,
  ms_played bigint NOT NULL DEFAULT 0,
  first_played timestamptz,
  last_played timestamptz,
  PRIMARY KEY (user_id, spotify_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listening_history TO authenticated;
GRANT ALL ON public.listening_history TO service_role;
ALTER TABLE public.listening_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own history" ON public.listening_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);