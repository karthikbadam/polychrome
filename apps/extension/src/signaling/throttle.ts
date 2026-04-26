/**
 * signaling/throttle.ts
 *
 * Cursor-coalescing throttle at a maximum of 30Hz (one flush per ~33ms).
 *
 * Design constraints:
 *  - MUST use setTimeout(fn, 33) — NOT requestAnimationFrame.
 *    Code may run inside a MV3 Service Worker which has no rAF.
 *  - Only the LAST payload per flush window is sent (coalescing).
 *  - Does nothing if the payload hasn't changed since the last send.
 */

/** A function that sends a cursor payload. */
export type SendFn<T> = (payload: T) => void;

/**
 * Creates a throttled cursor sender that coalesces rapid updates into at most
 * one call per 33ms window (≈30Hz max).
 *
 * @param send     The underlying send function.
 * @param intervalMs  Throttle window in milliseconds; default 33.
 * @returns  A `schedule(payload)` function to call on each cursor update, and
 *           a `flush()` function to immediately send any pending payload, and
 *           a `cancel()` function to cancel any pending send without firing.
 */
export function createCursorThrottle<T>(
  send: SendFn<T>,
  intervalMs = 33,
): { schedule: (payload: T) => void; flush: () => void; cancel: () => void } {
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== undefined) {
      const p = pending;
      pending = undefined;
      send(p);
    }
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = undefined;
  }

  function schedule(payload: T): void {
    pending = payload;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, intervalMs);
    }
    // If timer already running, we just replaced `pending`; it will be sent
    // when the timer fires (coalescing).
  }

  return { schedule, flush, cancel };
}
