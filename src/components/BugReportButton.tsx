import { useEffect, useRef, useState } from "react";
import { Bug } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const POS_KEY = "songweaver-bug-button-pos";
const SIZE = 40;
const EDGE = 12;
const DRAG_THRESHOLD = 6;

type Pos = { left: number; bottom: number };

function clamp(pos: Pos): Pos {
  const maxLeft = Math.max(EDGE, window.innerWidth - SIZE - EDGE);
  const maxBottom = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
  return {
    left: Math.min(maxLeft, Math.max(EDGE, pos.left)),
    bottom: Math.min(maxBottom, Math.max(EDGE, pos.bottom)),
  };
}

/** Floating, draggable "Report a bug" button. Defaults to the bottom-left corner; position is remembered on this device. */
export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [pos, setPos] = useState<Pos>({ left: 16, bottom: 16 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; startX: number; startY: number; from: Pos; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(POS_KEY);
      if (saved) setPos(clamp(JSON.parse(saved) as Pos));
    } catch {
      /* default corner */
    }
    const onResize = () => setPos((p) => clamp(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, from: pos, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    setPos(clamp({ left: d.from.left + dx, bottom: d.from.bottom - dy }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      suppressClick.current = true;
      setDragging(false);
      setPos((p) => {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(p));
        } catch {
          /* storage blocked */
        }
        return p;
      });
    }
  }

  async function submit() {
    const text = message.trim();
    if (!text) return;
    setSending(true);
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setSending(false);
      toast.error("Sign in to report a bug.");
      return;
    }
    const { error } = await supabase.from("bug_reports").insert({
      user_id: data.user.id,
      email: data.user.email ?? null,
      message: text.slice(0, 4000),
      page: window.location.pathname,
      user_agent: navigator.userAgent.slice(0, 500),
    });
    setSending(false);
    if (error) {
      toast.error("Couldn't send the report. Try again.");
      return;
    }
    toast.success("Thanks! Bug reported.");
    setMessage("");
    setOpen(false);
  }

  return (
    <>
      <Button
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setOpen(true);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Report a bug"
        title="Report a bug — drag to move"
        variant="outline"
        size="icon"
        data-bug-button
        className={
          "fixed z-[60] h-10 w-10 touch-none select-none rounded-full bg-card text-muted-foreground shadow-lg hover:text-foreground " +
          (dragging ? "cursor-grabbing scale-110 transition-none" : "cursor-grab")
        }
        style={{
          left: `calc(${pos.left}px + env(safe-area-inset-left, 0px))`,
          bottom: `calc(${pos.bottom}px + env(safe-area-inset-bottom, 0px))`,
        }}
      >
        <Bug className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report a bug</DialogTitle>
            <DialogDescription>What went wrong? Describe what you did and what happened.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder="E.g. I skipped a song and Crate kept showing the old one…"
          />
          <div className="flex justify-end">
            <Button onClick={submit} disabled={sending || !message.trim()}>
              {sending ? "Sending…" : "Send report"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
