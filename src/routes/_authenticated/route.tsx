import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) throw redirect({ to: "/auth" });
    const { data, error } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };
    // Only a real rejection (revoked/expired session) signs you out. A network
    // hiccup right after a reboot (Wi-Fi not up yet) keeps the saved session.
    const status = (error as { status?: number } | null)?.status;
    if (status && status >= 400 && status < 500) throw redirect({ to: "/auth" });
    return { user: s.session.user };
  },
  component: () => <Outlet />,
});
