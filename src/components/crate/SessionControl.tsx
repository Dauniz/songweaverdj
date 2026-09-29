import { History, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRadio } from "./radio-context";

/** Live: End session. Otherwise: Start (new) session, plus Resume when a saved session exists. */
export function SessionControl() {
  const { sessionLive, endSession, startSession, hasLastSession, resumeLastSession } = useRadio();

  if (sessionLive) {
    return (
      <Button variant="outline" size="sm" className="h-8 rounded-full px-2.5 sm:px-4" onClick={endSession}>
        <Square className="h-3.5 w-3.5" /> <span className="hidden sm:inline">End session</span>
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {hasLastSession && (
        <Button variant="ghost" size="sm" className="h-8 rounded-full px-1.5 text-muted-foreground sm:px-2.5" onClick={resumeLastSession}>
          <History className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Resume last session</span>
        </Button>
      )}
      <Button size="sm" className="h-8 rounded-full px-2 sm:px-3" onClick={() => void startSession()}>
        <Play className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{hasLastSession ? "Start new session" : "Start session"}</span>
      </Button>
    </div>
  );
}
