import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTimeline, eventPositions, type TimelineEvent } from './index.js';

const e = (at: number, label = 'x', by?: string): TimelineEvent => ({
  at, label, ...(by !== undefined ? { by } : {}),
});

afterEach(() => {
  document.body.replaceChildren();
  document.getElementById('pc-timeline-styles')?.remove();
});

// ---------------------------------------------------------------------------
// eventPositions
// ---------------------------------------------------------------------------

describe('eventPositions', () => {
  it('returns [] for no events', () => {
    expect(eventPositions([])).toEqual([]);
  });

  it('places a single event at the right edge', () => {
    expect(eventPositions([e(1000)])).toEqual([1]);
  });

  it('linearly distributes events between min and max', () => {
    const ps = eventPositions([e(0), e(50), e(100)]);
    expect(ps).toEqual([0, 0.5, 1]);
  });

  it('handles non-zero start times', () => {
    const ps = eventPositions([e(1000), e(1500), e(2000)]);
    expect(ps).toEqual([0, 0.5, 1]);
  });

  it('distributes evenly when all timestamps are equal', () => {
    const ps = eventPositions([e(5), e(5), e(5), e(5)]);
    expect(ps).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  it('handles unsorted input by using overall min/max', () => {
    const ps = eventPositions([e(50), e(0), e(100)]);
    expect(ps).toEqual([0.5, 0, 1]);
  });
});

// ---------------------------------------------------------------------------
// createTimeline
// ---------------------------------------------------------------------------

describe('createTimeline', () => {
  function mountTimeline(): HTMLDivElement {
    const div = document.createElement('div');
    document.body.appendChild(div);
    return div;
  }

  it('renders the empty state', () => {
    const c = mountTimeline();
    const t = createTimeline(c, { events: [] });
    const label = c.querySelector('.pc-timeline-label')!;
    expect(label.textContent).toBe('no checkpoints yet');
    const head = c.querySelector('.pc-timeline-head') as HTMLElement;
    expect(head.style.display).toBe('none');
    expect(c.querySelectorAll('.pc-timeline-marker')).toHaveLength(0);
    t.destroy();
  });

  it('renders one marker per event with correct left%', () => {
    const c = mountTimeline();
    const t = createTimeline(c, { events: [e(0, 'a'), e(50, 'b'), e(100, 'c')] });
    const dots = c.querySelectorAll<HTMLDivElement>('.pc-timeline-marker');
    expect(dots).toHaveLength(3);
    expect(dots[0]!.style.left).toBe('0%');
    expect(dots[1]!.style.left).toBe('50%');
    expect(dots[2]!.style.left).toBe('100%');
    t.destroy();
  });

  it('defaults headIndex to the last event and shows its label', () => {
    const c = mountTimeline();
    const t = createTimeline(c, { events: [e(0, 'first'), e(100, 'second', 'alice')] });
    expect(t.headIndex).toBe(1);
    const label = c.querySelector('.pc-timeline-label')!;
    expect(label.textContent).toBe('second - alice');
    t.destroy();
  });

  it('respects an explicit headIndex', () => {
    const c = mountTimeline();
    const t = createTimeline(c, { events: [e(0, 'a'), e(50, 'b'), e(100, 'c')], headIndex: 1 });
    expect(t.headIndex).toBe(1);
    expect(c.querySelector('.pc-timeline-label')!.textContent).toBe('b');
    t.destroy();
  });

  it('clicking on the track snaps the head to the nearest marker and fires onScrub', () => {
    const c = mountTimeline();
    const onScrub = vi.fn();
    const t = createTimeline(c, {
      events: [e(0, 'a'), e(50, 'b'), e(100, 'c')],
      headIndex: 0,
      onScrub,
    });

    const track = c.querySelector('.pc-timeline-track') as HTMLDivElement;
    // jsdom getBoundingClientRect returns zeros - patch a stable rect.
    track.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 10, width: 200, height: 10,
      toJSON: () => ({}),
    });

    // Click at x=160 (80% of width) - nearest is index 2 (at 100% = 1.0).
    track.dispatchEvent(new MouseEvent('click', { clientX: 160, bubbles: true }));
    expect(t.headIndex).toBe(2);
    expect(onScrub).toHaveBeenCalledWith(2);
    expect(c.querySelector('.pc-timeline-label')!.textContent).toBe('c');
    t.destroy();
  });

  it('does not fire onScrub when the click resolves to the same head index', () => {
    const c = mountTimeline();
    const onScrub = vi.fn();
    const t = createTimeline(c, {
      events: [e(0, 'a'), e(100, 'b')],
      headIndex: 0,
      onScrub,
    });
    const track = c.querySelector('.pc-timeline-track') as HTMLDivElement;
    track.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 10, width: 100, height: 10,
      toJSON: () => ({}),
    });

    track.dispatchEvent(new MouseEvent('click', { clientX: 5, bubbles: true })); // → 0
    expect(onScrub).not.toHaveBeenCalled();
    t.destroy();
  });

  it('update() replaces events and resets head to the latest by default', () => {
    const c = mountTimeline();
    const t = createTimeline(c, { events: [e(0, 'a')] });
    expect(t.headIndex).toBe(0);
    t.update({ events: [e(0, 'a'), e(10, 'b'), e(20, 'c')] });
    expect(t.headIndex).toBe(2);
    expect(c.querySelectorAll('.pc-timeline-marker')).toHaveLength(3);
    expect(c.querySelector('.pc-timeline-label')!.textContent).toBe('c');
    t.destroy();
  });

  it('update() with empty events shows the empty-state label', () => {
    const c = mountTimeline();
    const t = createTimeline(c, { events: [e(0, 'a'), e(10, 'b')] });
    t.update({ events: [] });
    expect(t.headIndex).toBe(-1);
    expect(c.querySelector('.pc-timeline-label')!.textContent).toBe('no checkpoints yet');
    t.destroy();
  });

  it('destroy() detaches listeners and clears the container', () => {
    const c = mountTimeline();
    const onScrub = vi.fn();
    const t = createTimeline(c, {
      events: [e(0, 'a'), e(100, 'b')],
      headIndex: 0,
      onScrub,
    });
    t.destroy();
    expect(c.children).toHaveLength(0);

    // Re-mount so the click target exists; assert no callback fires after destroy.
    const newTrack = document.createElement('div');
    c.appendChild(newTrack);
    newTrack.dispatchEvent(new MouseEvent('click', { clientX: 50, bubbles: true }));
    expect(onScrub).not.toHaveBeenCalled();
  });

  it('uses event.color when provided', () => {
    const c = mountTimeline();
    const t = createTimeline(c, {
      events: [{ at: 0, label: 'a', color: '#ff0000' }, { at: 100, label: 'b' }],
    });
    const dots = c.querySelectorAll<HTMLDivElement>('.pc-timeline-marker');
    expect(dots[0]!.style.background).toBe('rgb(255, 0, 0)');
    t.destroy();
  });

  it('injects styles only once even across multiple timelines', () => {
    createTimeline(mountTimeline(), { events: [] });
    createTimeline(mountTimeline(), { events: [] });
    expect(document.querySelectorAll('#pc-timeline-styles')).toHaveLength(1);
  });
});
