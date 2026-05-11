/**
 * @polychrome/replay-player - timeline UI component.
 *
 * A pure DOM widget that renders a horizontal timeline with event
 * markers and a draggable play-head. Decoupled from any sync layer:
 * the caller passes in events ({ at, label, by, color }) and receives
 * scrub/click callbacks. Used by the extension's side panel today;
 * future ot-core-backed demos can also use it.
 */

export interface TimelineEvent {
  /** Sortable position - typically `Date.now()` at the time of the event. */
  at: number;
  label: string;
  /** Optional actor / origin label (rendered next to the marker). */
  by?: string;
  /** Marker color; defaults to currentColor. */
  color?: string;
}

export interface TimelineOptions {
  events: TimelineEvent[];
  /** Index of the play-head (0..events.length-1, or -1 for none). */
  headIndex?: number;
  /** Fired when the user scrubs or clicks a marker. */
  onScrub?: (index: number) => void;
}

export interface TimelineHandle {
  update(opts: TimelineOptions): void;
  destroy(): void;
  readonly headIndex: number;
}

const NS = 'http://www.w3.org/1999/xhtml';

/**
 * 0..1 horizontal position for each event.
 *   - 0 events: [].
 *   - 1 event: [1] (right edge).
 *   - All events same `at`: distribute evenly across [0, 1].
 *   - Otherwise: linear interpolation from min(at) (=0) to max(at) (=1).
 */
export function eventPositions(events: TimelineEvent[]): number[] {
  if (events.length === 0) return [];
  if (events.length === 1) return [1];
  let min = events[0]!.at;
  let max = events[0]!.at;
  for (const e of events) { if (e.at < min) min = e.at; if (e.at > max) max = e.at; }
  if (min === max) {
    return events.map((_, i) => i / (events.length - 1));
  }
  const span = max - min;
  return events.map(e => (e.at - min) / span);
}

export function createTimeline(
  container: HTMLElement,
  initial: TimelineOptions = { events: [] },
): TimelineHandle {
  const doc = container.ownerDocument;
  injectStyles(doc);

  const root = doc.createElementNS(NS, 'div') as HTMLDivElement;
  root.className = 'pc-timeline';
  container.replaceChildren(root);

  const track = doc.createElementNS(NS, 'div') as HTMLDivElement;
  track.className = 'pc-timeline-track';
  root.appendChild(track);

  const head = doc.createElementNS(NS, 'div') as HTMLDivElement;
  head.className = 'pc-timeline-head';
  head.setAttribute('role', 'slider');
  head.setAttribute('aria-label', 'Timeline scrubber');
  root.appendChild(head);

  const labelBox = doc.createElementNS(NS, 'div') as HTMLDivElement;
  labelBox.className = 'pc-timeline-label';
  root.appendChild(labelBox);

  let state: { events: TimelineEvent[]; headIndex: number; onScrub: TimelineOptions['onScrub'] } = {
    events: initial.events,
    headIndex: initial.headIndex ?? (initial.events.length > 0 ? initial.events.length - 1 : -1),
    onScrub: initial.onScrub,
  };

  function render(): void {
    track.replaceChildren();
    const positions = eventPositions(state.events);
    for (let i = 0; i < state.events.length; i++) {
      const e = state.events[i]!;
      const dot = doc.createElementNS(NS, 'div') as HTMLDivElement;
      dot.className = 'pc-timeline-marker';
      dot.style.left = `${(positions[i] ?? 0) * 100}%`;
      dot.style.background = e.color ?? 'currentColor';
      dot.title = e.by ? `${e.label} - ${e.by}` : e.label;
      dot.dataset['index'] = String(i);
      track.appendChild(dot);
    }

    if (state.events.length === 0 || state.headIndex < 0) {
      head.style.display = 'none';
      labelBox.textContent = state.events.length === 0 ? 'no checkpoints yet' : '';
    } else {
      head.style.display = '';
      const idx = Math.min(state.headIndex, state.events.length - 1);
      head.style.left = `${(positions[idx] ?? 0) * 100}%`;
      const e = state.events[idx]!;
      labelBox.textContent = e.by ? `${e.label} - ${e.by}` : e.label;
    }
  }

  function nearestIndex(clientX: number): number {
    if (state.events.length === 0) return -1;
    const r = track.getBoundingClientRect();
    const x = r.width === 0 ? 0 : (clientX - r.left) / r.width;
    const positions = eventPositions(state.events);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < positions.length; i++) {
      const d = Math.abs((positions[i] ?? 0) - x);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  function commit(idx: number): void {
    if (idx < 0 || idx === state.headIndex) return;
    state.headIndex = idx;
    render();
    state.onScrub?.(idx);
  }

  function onTrackClick(ev: MouseEvent): void {
    const idx = nearestIndex(ev.clientX);
    if (idx >= 0) commit(idx);
  }
  track.addEventListener('click', onTrackClick);

  function onHeadDown(ev: PointerEvent): void {
    ev.preventDefault();
    try { head.setPointerCapture(ev.pointerId); } catch { /* not supported in tests */ }
    const move = (e: PointerEvent): void => {
      const idx = nearestIndex(e.clientX);
      if (idx >= 0 && idx !== state.headIndex) commit(idx);
    };
    const up = (): void => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  }
  head.addEventListener('pointerdown', onHeadDown);

  render();

  return {
    update(opts) {
      state = {
        events: opts.events,
        headIndex: opts.headIndex ?? (opts.events.length > 0 ? opts.events.length - 1 : -1),
        onScrub: opts.onScrub ?? state.onScrub,
      };
      render();
    },
    destroy() {
      track.removeEventListener('click', onTrackClick);
      head.removeEventListener('pointerdown', onHeadDown);
      container.replaceChildren();
    },
    get headIndex() { return state.headIndex; },
  };
}

// ---------------------------------------------------------------------------
// Styles - injected once per document on first createTimeline call.
// ---------------------------------------------------------------------------

const STYLE_ID = 'pc-timeline-styles';

function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .pc-timeline { position: relative; padding: 18px 8px 22px; user-select: none; }
    .pc-timeline-track {
      position: relative; height: 4px; border-radius: 2px;
      background: rgba(124, 92, 255, 0.18); cursor: pointer;
    }
    .pc-timeline-marker {
      position: absolute; top: -3px; width: 10px; height: 10px;
      border-radius: 50%; transform: translateX(-50%);
      background: #7c5cff; box-shadow: 0 0 0 2px rgba(255,255,255,0.06);
      pointer-events: none;
    }
    .pc-timeline-head {
      position: absolute; top: 12px; width: 14px; height: 18px;
      border-radius: 4px; transform: translateX(-50%);
      background: #ffffff; border: 1px solid #7c5cff;
      cursor: grab; touch-action: none;
    }
    .pc-timeline-head:active { cursor: grabbing; }
    .pc-timeline-label {
      margin-top: 18px; font-size: 12px; color: rgba(232, 234, 237, 0.8);
      min-height: 1.2em; text-align: center;
    }
    @media (prefers-color-scheme: light) {
      .pc-timeline-head { background: #1a1d23; border-color: #6240e8; }
      .pc-timeline-label { color: rgba(26, 29, 35, 0.7); }
    }
  `;
  doc.head.appendChild(style);
}
