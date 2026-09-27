import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/bugs")({
  head: () => ({
    meta: [
      { title: "Bug reports — Songweaver admin" },
      { name: "description", content: "Review bug reports submitted by Songweaver users." },
      { property: "og:title", content: "Bug reports — Songweaver admin" },
      { property: "og:description", content: "Review bug reports submitted by Songweaver users." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminBugs,
});

function AdminBugs() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-bugs"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user!.id)
        .eq("role", "admin");
      if (!roles?.length) return { admin: false, reports: [] };
      const { data: reports } = await supabase
        .from("bug_reports")
        .select("*")
        .order("created_at", { ascending: false });
      return { admin: true, reports: reports ?? [] };
    },
  });

  async function setStatus(id: string, status: "open" | "resolved") {
    await supabase.from("bug_reports").update({ status }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-bugs"] });
  }
  async function remove(id: string) {
    await supabase.from("bug_reports").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-bugs"] });
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!data?.admin)
    return (
      <div className="p-8">
        <p className="text-muted-foreground">You don't have access to this page.</p>
        <Link to="/studio" className="mt-4 inline-block text-primary">Back to Studio</Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Bug reports ({data.reports.length})</h1>
        <Link to="/studio" className="text-sm text-muted-foreground hover:text-foreground">Back to Studio</Link>
      </div>
      {data.reports.length === 0 && <p className="text-muted-foreground">No bug reports yet.</p>}
      <ul className="space-y-3">
        {data.reports.map((r) => (
          <li key={r.id} className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={r.status === "open" ? "text-primary" : ""}>{r.status}</span>
              <span>· {new Date(r.created_at).toLocaleString()}</span>
              {r.page && <span>· {r.page}</span>}
            </div>
            <p className="whitespace-pre-wrap text-sm">{r.message}</p>
            {r.user_agent && <p className="mt-2 truncate text-xs text-muted-foreground">{r.user_agent}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setStatus(r.id, r.status === "open" ? "resolved" : "open")}>
                {r.status === "open" ? "Mark resolved" : "Reopen"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(r.id)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
