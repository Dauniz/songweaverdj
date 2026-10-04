CREATE TABLE public.auth_handoffs (nonce text PRIMARY KEY, token_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.auth_handoffs TO service_role;
ALTER TABLE public.auth_handoffs ENABLE ROW LEVEL SECURITY;