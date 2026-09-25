CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.chat_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ON public.chat_messages (user_id, created_at);

CREATE TABLE public.library_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  spotify_id text NOT NULL,
  name text NOT NULL,
  artists text NOT NULL,
  album text,
  image_url text,
  preview_url text,
  spotify_url text,
  source_type text NOT NULL DEFAULT 'playlist',
  source_name text NOT NULL,
  source_period date,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, spotify_id, source_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_tracks TO authenticated;
GRANT ALL ON public.library_tracks TO service_role;
ALTER TABLE public.library_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tracks" ON public.library_tracks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.memory_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  content text NOT NULL,
  blob_id text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_nodes TO authenticated;
GRANT ALL ON public.memory_nodes TO service_role;
ALTER TABLE public.memory_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own memories" ON public.memory_nodes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.spotify_connections (
  user_id uuid PRIMARY KEY,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  display_name text,
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.spotify_connections TO service_role;
ALTER TABLE public.spotify_connections ENABLE ROW LEVEL SECURITY;