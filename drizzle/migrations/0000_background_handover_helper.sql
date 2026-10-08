-- lovable-cron-fallback-reviewed: per-minute job is scheduled only on enqueue and unscheduled after drain; songs end at arbitrary seconds so minute cadence is the coarsest that still lands finishes
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE public.pending_handovers (
  user_id uuid PRIMARY KEY,
  session_id text NOT NULL,
  track_id text NOT NULL,
  ends_at timestamptz NOT NULL,
  b_id text NOT NULL,
  v_id text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.pending_handovers TO authenticated;
GRANT ALL ON public.pending_handovers TO service_role;
ALTER TABLE public.pending_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own handovers read" ON public.pending_handovers FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own handovers delete" ON public.pending_handovers FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.handover_config (
  id int PRIMARY KEY DEFAULT 1,
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  CHECK (id = 1)
);
GRANT ALL ON public.handover_config TO service_role;
ALTER TABLE public.handover_config ENABLE ROW LEVEL SECURITY;
INSERT INTO public.handover_config (id) VALUES (1);

CREATE OR REPLACE FUNCTION public.arm_handover_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE tok text;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'handover-tick') THEN RETURN; END IF;
  SELECT token INTO tok FROM public.handover_config WHERE id = 1;
  PERFORM cron.schedule('handover-tick', '* * * * *', format($c$
    select net.http_post(
      url := 'https://project--9dc487f5-b202-4c71-a384-4034e8a4a210.lovable.app/api/public/handover-tick',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $c$, tok));
END $fn$;

CREATE OR REPLACE FUNCTION public.disarm_handover_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pending_handovers WHERE status = 'pending') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'handover-tick') THEN
    PERFORM cron.unschedule('handover-tick');
  END IF;
END $fn$;

REVOKE ALL ON FUNCTION public.arm_handover_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disarm_handover_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arm_handover_tick() TO service_role;
GRANT EXECUTE ON FUNCTION public.disarm_handover_tick() TO service_role;