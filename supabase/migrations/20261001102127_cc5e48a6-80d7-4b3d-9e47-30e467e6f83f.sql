ALTER TABLE public.spotify_connections ADD COLUMN IF NOT EXISTS last_recent_sync_at timestamptz;
CREATE TABLE public.spotify_playlist_snapshots (
  user_id uuid NOT NULL,
  playlist_id text NOT NULL,
  snapshot_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, playlist_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spotify_playlist_snapshots TO authenticated;
GRANT ALL ON public.spotify_playlist_snapshots TO service_role;
ALTER TABLE public.spotify_playlist_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own snapshots" ON public.spotify_playlist_snapshots FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);