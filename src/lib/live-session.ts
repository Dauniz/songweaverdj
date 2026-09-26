import type { RadioState, MazeEvent } from "@/components/crate/radio-context";

export const LIVE_KEY = "songweaver-live-session";
const LIVE_MAX_AGE = 30 * 60 * 1000;
type SavedSession = {
  radio: RadioState; sessionLive: boolean; events: MazeEvent[];
  played: string[]; artistSkips: [string, number][]; savedAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upNext?: any; upSkip?: any; door?: any; branchKey?: string | null;
};
export function readLiveSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    if (!s.savedAt || Date.now() - s.savedAt > LIVE_MAX_AGE || !(s.sessionLive || s.radio?.active)) {
      localStorage.removeItem(LIVE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

