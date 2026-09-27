import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Save, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/notepad")({
  head: () => ({
    meta: [
      { title: "Notepad — Songweaver admin" },
      { name: "description", content: "Admin mindmap for Songweaver ideas, branches and future features." },
      { property: "og:title", content: "Notepad — Songweaver admin" },
      { property: "og:description", content: "Admin mindmap for Songweaver ideas, branches and future features." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminNotepad,
});

type MindNode = {
  id: string;
  parentId: string | null;
  text: string;
  x: number;
  y: number;
  color?: string | undefined;
};

type Mindmap = { nodes: MindNode[] };

const BRANCH_COLORS = ["#8ab4f8", "#7ee0a3", "#f6c177", "#e5a1e0", "#f28b82", "#9adbe8"];

function seedMap(): Mindmap {
  const root: MindNode = { id: "root", parentId: null, text: "Songweaver", x: 660, y: 420 };
  const branches: Array<[string, string[]]> = [
    ["Uppspelning & Radio", ["Flervägs-dörrar (3+ val)", "Offline-läge / caching", "Bättre skip-detektering", "Blanda era + vibe automatiskt"]],
    ["Crate & AI", ["Röst-svar från Crate", "Djupare smakprofiler via Walrus", "Förklara varje val i konsolen", "Humör-detektering från lyssning"]],
    ["Socialt", ["Dela sessioner med vänner", "Gemensam radio (grupp-session)", "Veckans återupptäckter-kort", "Exportera maze som bild"]],
    ["Bibliotek & Sync", ["Inkrementell sync (endast nya låtar)", "Stöd för Apple Music / Tidal", "Tagga låtar manuellt", "Duplikat-hantering"]],
    ["Produkt & Affär", ["Publicering + Spotify quota extension", "Prisplan / premium-funktioner", "Onboarding A/B-test", "Mobilapp (PWA först)"]],
    ["Tekniskt", ["Realtids-push istället för polling", "Felövervakning (Sentry-likt)", "Prestanda: färre Spotify-anrop", "Test-sviter för radio-logiken"]],
  ];
  const nodes: MindNode[] = [root];
  branches.forEach(([title, children], i) => {
    const angle = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
    const bx = root.x + Math.cos(angle) * 400;
    const by = root.y + Math.sin(angle) * 300;
    const bid = `b${i}`;
    nodes.push({ id: bid, parentId: "root", text: title, x: bx, y: by, color: BRANCH_COLORS[i % BRANCH_COLORS.length] });
    children.forEach((c, j) => {
      const spread = (j - (children.length - 1) / 2) * 95;
      const cx = bx + Math.cos(angle) * 250 + Math.cos(angle + Math.PI / 2) * spread;
      const cy = by + Math.sin(angle) * 250 + Math.sin(angle + Math.PI / 2) * spread;
      nodes.push({ id: `${bid}c${j}`, parentId: bid, text: c, x: cx, y: cy, color: BRANCH_COLORS[i % BRANCH_COLORS.length] });
    });
  });
  return { nodes };
}

function AdminNotepad() {
  const qc = useQueryClient();
  const [map, setMap] = useState<Mindmap | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<Mindmap | null>(null);
  mapRef.current = map;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-notepad"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { admin: false as const };
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .eq("role", "admin");
      if (!roles?.length) return { admin: false as const };
      const { data: row } = await supabase
        .from("admin_notes")
        .select("id, content")
        .eq("user_id", u.user.id)
        .eq("title", "Songweaver roadmap")
        .maybeSingle();
      return { admin: true as const, userId: u.user.id, row };
    },
  });

  useEffect(() => {
    if (!data || !data.admin || map) return;
    const content = data.row?.content as Mindmap | undefined;
    setMap(content && Array.isArray(content.nodes) && content.nodes.length ? content : seedMap());
  }, [data, map]);

  const persist = useCallback(
    async (next: Mindmap) => {
      if (!data || !data.admin) return;
      setSaveState("saving");
      const payload = { user_id: data.userId, title: "Songweaver roadmap", content: next as unknown as Record<string, never> };
      const { error } = data.row
        ? await supabase.from("admin_notes").update({ content: payload.content }).eq("id", data.row.id)
        : await supabase.from("admin_notes").insert(payload);
      setSaveState(error ? "idle" : "saved");
      if (!error) qc.invalidateQueries({ queryKey: ["admin-notepad"] });
    },
    [data, qc],
  );

  const scheduleSave = useCallback(
    (next: Mindmap) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => persist(next), 800);
    },
    [persist],
  );

  const update = useCallback(
    (fn: (m: Mindmap) => Mindmap) => {
      setMap((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  function onNodePointerDown(e: React.PointerEvent, id: string) {
    if (editingId === id) return;
    const node = mapRef.current?.nodes.find((n) => n.id === id);
    const canvas = canvasRef.current;
    if (!node || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    dragRef.current = { id, dx: e.clientX - rect.left - node.x, dy: e.clientY - rect.top - node.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onCanvasPointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const panDrag = panRef.current;
    if (panDrag) {
      setPan({ x: panDrag.px + e.clientX - panDrag.sx, y: panDrag.py + e.clientY - panDrag.sy });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - drag.dx - pan.x;
    const y = e.clientY - rect.top - drag.dy - pan.y;
    setMap((prev) =>
      prev ? { nodes: prev.nodes.map((n) => (n.id === drag.id ? { ...n, x, y } : n)) } : prev,
    );
  }
  function onPointerUp() {
    if (dragRef.current && mapRef.current) scheduleSave(mapRef.current);
    dragRef.current = null;
    panRef.current = null;
  }

  function addChild(parentId: string) {
    const parent = mapRef.current?.nodes.find((n) => n.id === parentId);
    if (!parent) return;
    const id = `n${Date.now().toString(36)}`;
    const siblings = mapRef.current?.nodes.filter((n) => n.parentId === parentId).length ?? 0;
    const angle = siblings * 0.9 - 0.6;
    update((m) => ({
      nodes: [
        ...m.nodes,
        {
          id,
          parentId,
          text: "Ny idé",
          x: parent.x + Math.cos(angle) * 190,
          y: parent.y + Math.sin(angle) * 140 + 60,
          color: parent.color,
        },
      ],
    }));
    setEditingId(id);
  }

  function removeNode(id: string) {
    update((m) => {
      const doomed = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of m.nodes) {
          if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
            doomed.add(n.id);
            grew = true;
          }
        }
      }
      return { nodes: m.nodes.filter((n) => !doomed.has(n.id)) };
    });
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!data?.admin)
    return (
      <div className="p-8">
        <p className="text-muted-foreground">You don't have access to this page.</p>
        <Link to="/studio" className="mt-4 inline-block text-primary">Back to Studio</Link>
      </div>
    );
  if (!map) return <div className="p-8 text-muted-foreground">Preparing notepad…</div>;

  const byId = new Map(map.nodes.map((n) => [n.id, n]));

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
      <div
        ref={canvasRef}
        className="relative flex-1 overflow-hidden bg-background"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ touchAction: "none" }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {map.nodes.map((n) => {
            if (!n.parentId) return null;
            const p = byId.get(n.parentId);
            if (!p) return null;
            const mx = (p.x + n.x) / 2;
            return (
              <path
                key={`e-${n.id}`}
                d={`M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${n.y}, ${n.x} ${n.y}`}
                fill="none"
                stroke={n.color ?? "hsl(var(--border))"}
                strokeOpacity={0.5}
                strokeWidth={n.parentId === "root" ? 2 : 1.5}
              />
            );
          })}
        </svg>
        {map.nodes.map((n) => {
          const isRoot = n.id === "root";
          return (
            <div
              key={n.id}
              className="group absolute select-none"
              style={{ left: n.x, top: n.y, transform: "translate(-50%, -50%)" }}
              onPointerDown={(e) => onNodePointerDown(e, n.id)}
            >
              <div
                className={`flex items-center gap-1.5 rounded-xl border bg-card shadow-md transition-shadow hover:shadow-lg ${
                  isRoot ? "px-5 py-3 font-display text-lg font-bold" : n.parentId === "root" ? "px-4 py-2.5 font-semibold" : "px-3 py-2 text-sm"
                }`}
                style={n.color ? { borderColor: n.color, borderWidth: 1.5 } : undefined}
              >
                {editingId === n.id ? (
                  <input
                    autoFocus
                    className="w-40 bg-transparent outline-none"
                    defaultValue={n.text}
                    onBlur={(e) => {
                      update((m) => ({ nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, text: e.target.value || x.text } : x)) }));
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span onDoubleClick={() => setEditingId(n.id)} className="cursor-text whitespace-nowrap">
                    {n.text}
                  </span>
                )}
                <span className="ml-1 hidden items-center gap-0.5 group-hover:flex">
                  <button
                    title="Lägg till gren"
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => addChild(n.id)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  {!isRoot && (
                    <button
                      title="Ta bort (med undergrenar)"
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeNode(n.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        <div className="pointer-events-none absolute bottom-3 left-4 text-xs text-muted-foreground">
          Dra noder för att flytta · dubbelklicka för att redigera · håll muspekaren över en nod för att lägga till eller ta bort grenar
        </div>
      </div>
    </div>
  );
}
