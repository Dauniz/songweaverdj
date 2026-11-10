/**
 * Hedged call with a hard deadline, for latency-critical AI picks.
 * Starts one attempt; if it hasn't answered after `hedgeMs`, starts a second identical one.
 * The first non-null answer wins and the other attempt is aborted. After `deadlineMs`
 * everything is aborted and `null` is returned so the caller can fall back to plain code.
 */
export function hedged<T>(
  attempt: (signal: AbortSignal) => Promise<T | null>,
  opts: { hedgeMs: number; deadlineMs: number; maxAttempts?: number },
): Promise<T | null> {
  const max = opts.maxAttempts ?? 2;
  return new Promise<T | null>((resolve) => {
    const ctrls: AbortController[] = [];
    let done = false;
    let pending = 0;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadline);
      for (const c of ctrls) c.abort();
      resolve(v);
    };
    const launch = () => {
      if (done || ctrls.length >= max) return;
      const c = new AbortController();
      ctrls.push(c);
      pending++;
      attempt(c.signal)
        .catch(() => null)
        .then((v) => {
          pending--;
          if (v !== null && v !== undefined) return finish(v);
          // This attempt gave nothing: start the backup now instead of waiting for the hedge timer.
          if (ctrls.length < max) {
            clearTimeout(hedgeTimer);
            launch();
          } else if (pending === 0) finish(null);
        });
    };
    const deadline = setTimeout(() => finish(null), opts.deadlineMs);
    launch();
    hedgeTimer = setTimeout(launch, opts.hedgeMs);
  });
}
