DO $$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid='public.listening_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%event%play_through%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.listening_events DROP CONSTRAINT %I', c); END IF;
  SELECT conname INTO c FROM pg_constraint WHERE conrelid='public.listening_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%mode%era%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.listening_events DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE public.listening_events ADD CONSTRAINT listening_events_event_check CHECK (event IN ('play_through','early_skip','replay','explicit_fav','explicit_skip','steer'));
ALTER TABLE public.listening_events ADD CONSTRAINT listening_events_mode_check CHECK (mode IS NULL OR mode IN ('era','vibe','mixed'));