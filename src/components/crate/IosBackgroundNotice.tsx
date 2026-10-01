import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isAppleTouchDevice } from "@/lib/spotify-open";

const STORAGE_KEY = "ios-background-notice-dismissed";

/**
 * One-time heads-up for iPhone/iPad: while Songweaver runs through the Lovable
 * preview, iOS suspends browser tabs in the background, so a live session needs
 * the tab to stay open and visible. Shown once per device, then never again.
 */
export function IosBackgroundNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isAppleTouchDevice()) return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      /* storage blocked — still show once */
    }
    setOpen(true);
  }, []);

  function dismiss() {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-sm rounded-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>A heads-up for iPhone &amp; iPad</AlertDialogTitle>
          <AlertDialogDescription>
            Songweaver isn't fully optimized on your device. While the app runs
            through the Lovable preview, iOS suspends browser tabs in the
            background — so a session only stays alive while Songweaver is open
            and active on your screen. Keep the tab in the foreground for the
            whole session; once Songweaver is published to its own URL this
            limitation goes away.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction
            onClick={dismiss}
            className="h-11 w-full rounded-md text-base font-semibold sm:w-auto sm:px-8"
          >
            Got it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
