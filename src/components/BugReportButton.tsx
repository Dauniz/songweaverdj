import { useState } from "react";
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

export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

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
      <button
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        title="Report a bug"
        className="fixed bottom-4 left-4 z-40 rounded-full border bg-card p-2.5 text-muted-foreground shadow-lg transition hover:scale-110 hover:text-foreground"
      >
        <Bug className="h-4 w-4" />
      </button>
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
