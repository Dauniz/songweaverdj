import { History, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRadio } from "./radio-context";

/** Sessions start from a prompt, a search, or pressing play in Spotify — only End lives here. */
export function SessionControl() {
  const { sessionLive, endSession, hasLastSession, resumeLastSession } = useRadio();

  if (sessionLive) {
    return (
      <Button variant="outline" size="sm" className="h-8 rounded-full px-2.5 sm:px-4" onClick={endSession}>
        <Square className="h-3.5 w-3.5" /> <span className="hidden sm:inline">End session</span>
      </Button>
    );
  }
  if (!hasLastSession) return null;
  return (
    <Button variant="ghost" size="sm" className="h-8 rounded-full px-2.5 text-muted-foreground sm:px-3" onClick={resumeLastSession}>
      <History className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Resume last session</span>
    </Button>
  );
}
