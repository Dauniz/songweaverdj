CREATE INDEX IF NOT EXISTS library_tracks_user_period_idx ON public.library_tracks (user_id, source_period DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS library_tracks_user_id_idx ON public.library_tracks (user_id, id);
CREATE INDEX IF NOT EXISTS listening_events_user_created_idx ON public.listening_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_nodes_user_created_idx ON public.memory_nodes (user_id, created_at DESC);