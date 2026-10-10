import { ExternalLink } from "lucide-react";
import type { CardTrack } from "./TrackCard";
import type { SpotifyPlaybackIssue } from "./radio-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  issue: SpotifyPlaybackIssue | null;
  track: CardTrack | null;
  retrying: boolean;
  onDismiss: () => void;
  onOpenSpotify: () => void;
  onConnect: () => void;
  onRetry: () => void;
};

export function SpotifyOpenDialog({
  issue,
  track,
  retrying,
  onDismiss,
  onOpenSpotify,
  onConnect,
  onRetry,
}: Props) {
  const connect = issue?.status === "connect_required";
  const premium = issue?.status === "premium_required";
  const needsAuth = connect;
  const showTrack = false;

  return (
    <AlertDialog open={Boolean(issue)} onOpenChange={(open) => !open && onDismiss()}>
      <AlertDialogContent className="max-w-sm rounded-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {connect ? "Connect Spotify" : premium ? "Spotify Premium required" : "Open Spotify"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {connect || premium
              ? issue?.message
              : "Crate's knocking, but Spotify isn't answering. Open it and let your DJ in."}
            {showTrack && track ? ` Then Crate will start “${track.name}” there.` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {showTrack && track?.image_url && (
          <div className="flex items-center gap-3 rounded-md border bg-surface p-2">
            <img src={track.image_url} alt="" className="h-12 w-12 rounded-sm object-cover" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{track.name}</p>
              <p className="truncate text-xs text-muted-foreground">{track.artists}</p>
            </div>
          </div>
        )}
        {needsAuth ? (
          <div className="flex flex-col items-center gap-3">
            <AlertDialogAction
              onClick={onConnect}
              className="h-11 w-full rounded-md text-base font-semibold"
            >
              Connect
            </AlertDialogAction>
            <AlertDialogCancel className="h-auto border-none bg-transparent p-0 text-xs font-normal text-muted-foreground shadow-none underline underline-offset-2 hover:bg-transparent hover:text-foreground">
              Not now
            </AlertDialogCancel>
          </div>
        ) : premium ? (
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
          </AlertDialogFooter>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <AlertDialogAction
              onClick={onOpenSpotify}
              className="h-11 w-full rounded-md text-base font-semibold"
            >
              <ExternalLink /> Open Spotify
            </AlertDialogAction>
            <AlertDialogCancel className="h-auto border-none bg-transparent p-0 text-xs font-normal text-muted-foreground shadow-none underline underline-offset-2 hover:bg-transparent hover:text-foreground">
              Not now
            </AlertDialogCancel>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
