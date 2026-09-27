import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Save, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/notepad")({
  head: () => ({
    meta: [
      { title: "Notepad — Songweaver admin" },
      { name: "description", content: "Admin notepad for Songweaver ideas, branches and future features." },
      { property: "og:title", content: "Notepad — Songweaver admin" },
      { property: "og:description", content: "Admin notepad for Songweaver ideas, branches and future features." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminNotepad,
});

function AdminNotepad() {
  const qc = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<Awaited<ReturnType<typeof loadNotes>> | undefined>(undefined拿来);
  dataRef.current = data as never;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-notepad"],
    queryFn: loadNotes,
  });

  useEffect(() => {
    if (!data || !data.admin || text !== null) return;
    const raw = data.row?.content as { text?: string } | undefined;
    setText(typeof raw?.text === "string" ? raw.text : "");
  }, [data, text]);

  const persist = useCallback(
    async (next: string) => {
      if (!dataRef.current || !dataRef.current.admin) return;
      setSaveState("saving");
      const d = dataRef.current;
      const payload = { user_id: d.userId, title: "Songweaver roadmap", content: { text: next } };
      const { error } = d.row
        ? await supabase.from("admin_notes").update({ content: payload.content }).eq("id", d.row.id)
        : await supabase.from("admin_notes").insert(payload);
      setSaveState(error ? "idle" : "saved");
      if (!error) qc.invalidateQueries({ queryKey: ["admin-notepad"] });
    },
    [qc],
  );

  const onTextChange = useCallback(
    (next: string) => {
      setText(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => persist(next), 800);
    },
    [persist],
  );

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!data?.admin)
    return (
      <div className="p-8">
        <p className="text-muted-foreground">You don't have access to this page.</p>
        <Link to="/studio" className="mt-4 inline-block text-primary">Back to Studio</Link>
      </div>
    );
  if (text === null) return <div className="p-8 text-muted-foreground">Preparing notepad…</div>;

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-xl font-bold">Notepad — framtida funktioner</h1>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {saveState === "saving" ? (
              <><Save className="h-3 w-3 animate-pulse" /> Sparar…</>
            ) : saveState === "saved" ? (
              <><Check className="h-3 w-3 text-primary" /> Sparat</>
            ) : null}
          </span>
        </div>
        <div className="flex gap-3 text-sm">
          <Link to="/admin/bugs" className="text-muted-foreground hover:text-foreground">Bug reports</Link>
          <Link to="/studio" className="text-muted-foreground hover:text-foreground">Back to Studio</Link>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Skriv fritt — idéer, branches och framtida funktioner för Songweaver…"
        spellCheck={false}
        className="flex-1 resize-none bg-background p-6 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
