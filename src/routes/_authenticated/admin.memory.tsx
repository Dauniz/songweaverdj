import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getAllTesterMemories } from "@/lib/admin-memory.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/memory")({
  head: () => ({
    meta: [
      { title: "Tester Walrus memory — Songweaver admin" },
      { name: "description", content: "Admin view of every tester's Walrus memory history in Songweaver." },
      { property: "og:title", content: "Tester Walrus memory — Songweaver admin" },
      { property: "og:description", content: "Admin view of every tester's Walrus memory history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminMemory,
});

type Data = Awaited<ReturnType<typeof getAllTesterMemories>>;

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}

function toCsv(users: Data["users"]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["tester", "email", "created_at", "kind", "origin", "status", "walrus_blob", "content"]];
  for (const u of users)
    for (const m of u.memories)
      rows.push([u.spotifyName ?? "", u.email ?? "", m.created_at, m.kind, m.origin, m.status, m.blob_id ?? "", m.content]);
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

function AdminMemory() {
  const fetchAll = useServerFn(getAllTesterMemories);
  const { data, isLoading, error } = useQuery({ queryKey: ["admin-memory"], queryFn: () => fetchAll(), retry: false });
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (error || !data)
    return (
      <div className="p-8">
        <p className="text-muted-foreground">You don't have access to this page.</p>
        <Link to="/studio" className="mt-4 inline-block text-primary">Back to Studio</Link>
      </div>
    );

  const total = data.users.reduce((n, u) => n + u.memories.length, 0);
  const stored = data.users.reduce((n, u) => n + u.memories.filter((m) => m.status === "stored").length, 0);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Tester Walrus memory</h1>
        <div className="flex gap-3 text-sm">
          <Link to="/admin/bugs" className="text-muted-foreground hover:text-foreground">Bugs</Link>
          <Link to="/admin/notepad" className="text-muted-foreground hover:text-foreground">Notepad</Link>
          <Link to="/studio" className="text-muted-foreground hover:text-foreground">Back to Studio</Link>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Testers", data.users.length],
          ["Spotify connected", data.users.filter((u) => u.spotifyConnected).length],
          ["Memories", total],
          ["Stored on Walrus", stored],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg border bg-card p-4">
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-xs text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => download(`songweaver-memory-${stamp}.csv`, toCsv(data.users), "text/csv")}>
          Export CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => download(`songweaver-memory-${stamp}.json`, JSON.stringify(data, null, 2), "application/json")}>
          Export JSON
        </Button>
      </div>

      <ul className="space-y-3">
        {data.users.map((u) => (
          <li key={u.id} className="rounded-lg border bg-card">
            <button className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left" onClick={() => setOpen(open === u.id ? null : u.id)}>
              <div>
                <div className="font-semibold">{u.spotifyName ?? u.email ?? "Guest"}</div>
                <div className="text-xs text-muted-foreground">
                  {u.email ?? "no email"} · joined {new Date(u.createdAt).toLocaleDateString()}
                  {u.lastListen && ` · last listen ${new Date(u.lastListen).toLocaleString()}`}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {u.memories.length} memories · {u.plays} plays · {u.skips} skips
              </div>
            </button>
            {open === u.id && (
              <div className="border-t p-4">
                {u.memories.length === 0 && <p className="text-sm text-muted-foreground">No memories yet.</p>}
                <ul className="space-y-2">
                  {u.memories.map((m) => (
                    <li key={m.id} className="text-sm">
                      <div className="text-xs text-muted-foreground">
                        {new Date(m.created_at).toLocaleString()} · {m.kind} · {m.origin} ·{" "}
                        <span className={m.status === "stored" ? "text-primary" : ""}>{m.status}</span>
                        {m.blob_id && !m.blob_id.startsWith("job:") && <span className="ml-1 font-mono">· {m.blob_id.slice(0, 16)}…</span>}
                      </div>
                      <p>{m.content}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
