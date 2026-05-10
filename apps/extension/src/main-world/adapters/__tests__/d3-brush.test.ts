// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyBrush,
  d3BrushAdapter,
  findBrushGroups,
  readBrush,
  snapshotsEqual,
  type BrushSnapshot,
} from '../d3-brush.js';

afterEach(() => { document.body.replaceChildren(); });

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeBrushGroup(opts: {
  overlay: { w: number; h: number };
  selection?: { x: number; y: number; w: number; h: number } | null;
}): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as unknown as SVGGElement;
  (g as Element).setAttribute('class', 'brush');

  const overlay = document.createElementNS(SVG_NS, 'rect');
  overlay.setAttribute('class', 'overlay');
  overlay.setAttribute('width', String(opts.overlay.w));
  overlay.setAttribute('height', String(opts.overlay.h));
  g.appendChild(overlay);

  const sel = document.createElementNS(SVG_NS, 'rect');
  sel.setAttribute('class', 'selection');
  if (opts.selection) {
    sel.setAttribute('x', String(opts.selection.x));
    sel.setAttribute('y', String(opts.selection.y));
    sel.setAttribute('width', String(opts.selection.w));
    sel.setAttribute('height', String(opts.selection.h));
  } else {
    sel.setAttribute('width', '0');
    sel.setAttribute('height', '0');
  }
  g.appendChild(sel);
  return g;
}

// ---------------------------------------------------------------------------
// URL matcher
// ---------------------------------------------------------------------------

describe('d3BrushAdapter.matches', () => {
  const m = (url: string): boolean => d3BrushAdapter.matches(new URL(url));
  it('matches public viz hosts', () => {
    expect(m('https://idl.uw.edu/mosaic/examples/cross-filter')).toBe(true);
    expect(m('https://uwdata.github.io/mosaic/')).toBe(true);
    expect(m('https://observablehq.com/@uwdata/mosaic')).toBe(true);
    expect(m('https://bl.ocks.org/mbostock/4063318')).toBe(true);
  });
  it('skips the polychrome demo origin (demos sync directly)', () => {
    expect(m('https://karthikbadam.github.io/polychrome/examples/scatterplot/')).toBe(false);
  });
  it('skips the local landing/demo dev ports', () => {
    expect(m('http://localhost:5180/')).toBe(false);
    expect(m('http://localhost:5182/')).toBe(false);
    expect(m('http://localhost:5184/?room=abc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readBrush
// ---------------------------------------------------------------------------

describe('readBrush', () => {
  it('returns null on a non-brush element', () => {
    const div = document.createElement('div');
    expect(readBrush(div)).toBeNull();
  });

  it('returns no-selection snapshot when selection rect is empty', () => {
    const g = makeBrushGroup({ overlay: { w: 200, h: 100 }, selection: null });
    expect(readBrush(g)).toEqual({ sel: null, ow: 200, oh: 100 });
  });

  it('returns the selection extent when present', () => {
    const g = makeBrushGroup({
      overlay: { w: 200, h: 100 },
      selection: { x: 10, y: 20, w: 50, h: 30 },
    });
    expect(readBrush(g)).toEqual({ sel: [10, 20, 50, 30], ow: 200, oh: 100 });
  });

  it('treats display:none on the selection rect as no-selection', () => {
    const g = makeBrushGroup({
      overlay: { w: 200, h: 100 },
      selection: { x: 10, y: 20, w: 50, h: 30 },
    });
    const sel = g.querySelector('rect.selection') as SVGRectElement;
    sel.style.display = 'none';
    expect(readBrush(g)).toEqual({ sel: null, ow: 200, oh: 100 });
  });
});

// ---------------------------------------------------------------------------
// snapshotsEqual
// ---------------------------------------------------------------------------

describe('snapshotsEqual', () => {
  it('handles identical snapshots', () => {
    const a: BrushSnapshot = { sel: [1, 2, 3, 4], ow: 100, oh: 50 };
    const b: BrushSnapshot = { sel: [1, 2, 3, 4], ow: 100, oh: 50 };
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it('detects different selections', () => {
    const a: BrushSnapshot = { sel: [1, 2, 3, 4], ow: 100, oh: 50 };
    const b: BrushSnapshot = { sel: [1, 2, 3, 5], ow: 100, oh: 50 };
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it('detects null vs non-null', () => {
    const a: BrushSnapshot = { sel: [1, 2, 3, 4], ow: 100, oh: 50 };
    const b: BrushSnapshot = { sel: null, ow: 100, oh: 50 };
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it('two null-selection snapshots with same overlay are equal', () => {
    const a: BrushSnapshot = { sel: null, ow: 100, oh: 50 };
    const b: BrushSnapshot = { sel: null, ow: 100, oh: 50 };
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it('different overlay dims are not equal', () => {
    const a: BrushSnapshot = { sel: null, ow: 100, oh: 50 };
    const b: BrushSnapshot = { sel: null, ow: 100, oh: 60 };
    expect(snapshotsEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findBrushGroups
// ---------------------------------------------------------------------------

describe('findBrushGroups', () => {
  it('returns brushes in document order', () => {
    const wrap = document.createElement('div');
    wrap.appendChild(makeBrushGroup({ overlay: { w: 10, h: 10 } }));
    wrap.appendChild(makeBrushGroup({ overlay: { w: 20, h: 20 } }));
    document.body.appendChild(wrap);
    const found = findBrushGroups();
    expect(found).toHaveLength(2);
    expect(+(found[0]!.querySelector('rect.overlay')!.getAttribute('width') ?? '0')).toBe(10);
    expect(+(found[1]!.querySelector('rect.overlay')!.getAttribute('width') ?? '0')).toBe(20);
  });

  it('returns [] when there are no brushes', () => {
    expect(findBrushGroups()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyBrush - dispatches mouse events on the overlay
// ---------------------------------------------------------------------------

describe('applyBrush', () => {
  it('dispatches mousedown + mousemove + mouseup on the overlay for a non-null selection', () => {
    const g = makeBrushGroup({ overlay: { w: 200, h: 100 } });
    document.body.appendChild(g);
    const overlay = g.querySelector('rect.overlay') as Element;
    // jsdom getBoundingClientRect returns zeros; spoof a known box.
    overlay.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100,
      toJSON: () => ({}),
    });
    const seen: Array<{ type: string; x: number; y: number }> = [];
    overlay.addEventListener('mousedown', (e) => seen.push({ type: 'mousedown', x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));
    overlay.addEventListener('mousemove', (e) => seen.push({ type: 'mousemove', x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));
    overlay.addEventListener('mouseup',   (e) => seen.push({ type: 'mouseup',   x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));

    applyBrush(g, { sel: [10, 20, 50, 30], ow: 200, oh: 100 });
    expect(seen.map(e => e.type)).toEqual(['mousedown', 'mousemove', 'mousemove', 'mouseup']);
    expect(seen[0]).toEqual({ type: 'mousedown', x: 10, y: 20 });
    expect(seen[3]).toEqual({ type: 'mouseup',   x: 60, y: 50 });
  });

  it('clears the brush by dispatching a single click on the overlay', () => {
    const g = makeBrushGroup({ overlay: { w: 100, h: 50 } });
    document.body.appendChild(g);
    const overlay = g.querySelector('rect.overlay') as Element;
    overlay.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 50, width: 100, height: 50,
      toJSON: () => ({}),
    });
    const seen: string[] = [];
    overlay.addEventListener('mousedown', () => seen.push('down'));
    overlay.addEventListener('mouseup', () => seen.push('up'));
    overlay.addEventListener('mousemove', () => seen.push('move'));

    applyBrush(g, { sel: null, ow: 100, oh: 50 });
    expect(seen).toEqual(['down', 'up']);
  });

  it('rescales the extent when the remote overlay was a different size', () => {
    const g = makeBrushGroup({ overlay: { w: 200, h: 100 } });
    document.body.appendChild(g);
    const overlay = g.querySelector('rect.overlay') as Element;
    // Local viewport box is 400 wide (2x the recorded ow). The replay
    // should scale the recorded extent by that factor.
    overlay.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 200, width: 400, height: 200,
      toJSON: () => ({}),
    });
    const downs: Array<{ x: number; y: number }> = [];
    overlay.addEventListener('mousedown', (e) => downs.push({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));

    applyBrush(g, { sel: [10, 20, 50, 30], ow: 200, oh: 100 });
    expect(downs[0]).toEqual({ x: 20, y: 40 }); // 10*2, 20*2
  });

  it('is a no-op if there is no overlay rect', () => {
    const g = document.createElementNS(SVG_NS, 'g') as unknown as SVGGElement;
    (g as Element).setAttribute('class', 'brush');
    expect(() => applyBrush(g, { sel: [0, 0, 10, 10], ow: 100, oh: 50 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Sanity: name + identity
// ---------------------------------------------------------------------------

describe('d3BrushAdapter shape', () => {
  it('has the expected name', () => {
    expect(d3BrushAdapter.name).toBe('d3-brush');
  });
  it('exports an install function', () => {
    expect(typeof d3BrushAdapter.install).toBe('function');
  });
});

// Reference to silence unused-vi import if any.
void vi;
