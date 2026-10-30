import { useEffect, useState } from "react";

const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * True once the mouse (and keyboard) have been still for `timeoutMs`; false
 * again on the next movement. Always false while disabled.
 */
export function useIdle(timeoutMs: number, enabled = true): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const wake = (): void => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), timeoutMs);
    };
    timer = setTimeout(() => setIdle(true), timeoutMs);
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, wake, { passive: true });
    }
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, wake);
      setIdle(false);
    };
  }, [timeoutMs, enabled]);

  return enabled && idle;
}
