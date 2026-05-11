/**
 * views.ts - the nine coordinated views.
 *
 * Each view exposes the same { mount, update } interface so the layout
 * can put it into the desktop grid or the mobile carousel without
 * caring what kind of chart it is. Views never own their own filter
 * state - they read the shared FilterMap and emit dimension-keyed
 * filter changes through `onFilterChange`.
 */

import * as d3 from 'd3';

import { type Planet, type Dim, type NumericDim, type CategoricalDim, DIM_LABELS, LOG_SCALE } from './data.js';
import { type FilterMap, type FilterValue, filterPlanets } from './filters.js';

export interface ViewContext {
  /** Full unfiltered rows. */
  all: readonly Planet[];
  /** Current filter map, including this view's own filter. */
  filters: FilterMap;
  /**
   * Apply or clear a filter on a specific dimension. Passing null
   * clears the filter for `dim` (recorded as a fresh op so peers see
   * the clear immediately).
   */
  onFilterChange: (dim: Dim, next: FilterValue) => void;
}

export interface ViewHandle {
  /** Title shown in the view's header. */
  readonly title: string;
  /** Mount the view into a clean container. Idempotent. */
  mount(container: HTMLElement, ctx: ViewContext): void;
  /** Re-render in place after a filter change. Container is the same as mount(). */
  update(ctx: ViewContext): void;
  /** True iff the view's filter is currently active (drives the highlight). */
  hasActiveFilter(filters: FilterMap): boolean;
}

const HIST_BINS = 16;

// ---------------------------------------------------------------------------
// Histogram view (numeric dim, range brush filter)
// ---------------------------------------------------------------------------

export function histogramView(dim: NumericDim): ViewHandle {
  const log = LOG_SCALE[dim];
  let host: HTMLElement | null = null;
  let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  let ctxRef: ViewContext | null = null;

  function render(): void {
    if (!host || !ctxRef) return;
    const { all, filters, onFilterChange } = ctxRef;

    // Domain over ALL rows so brushing one view doesn't reshape its own axes.
    const values = all.map(p => p[dim] as number).filter(v => Number.isFinite(v) && v > (log ? 0 : -Infinity));
    if (values.length === 0) return;
    const extent = d3.extent(values) as [number, number];

    // Bin edges.
    let edges: number[];
    if (log) {
      const lo = Math.log10(extent[0]);
      const hi = Math.log10(extent[1]);
      edges = d3.range(HIST_BINS + 1).map(i => Math.pow(10, lo + (hi - lo) * (i / HIST_BINS)));
    } else {
      edges = d3.range(HIST_BINS + 1).map(i => extent[0] + (extent[1] - extent[0]) * (i / HIST_BINS));
    }

    // Counts for both unfiltered and cross-filtered (excluding our own dim).
    const filteredRows = filterPlanets(all, filters, dim);
    const totalBins = bin(values, edges);
    const filteredBins = bin(filteredRows.map(p => p[dim] as number).filter(Number.isFinite), edges);

    const rect = host.getBoundingClientRect();
    const w = rect.width || 280;
    const h = rect.height || 140;
    const margin = { top: 6, right: 8, bottom: 22, left: 8 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    if (!svg) {
      svg = d3.select(host).append('svg').attr('width', '100%').attr('height', '100%');
    } else {
      svg.attr('viewBox', `0 0 ${w} ${h}`);
    }
    svg.attr('viewBox', `0 0 ${w} ${h}`);
    svg.selectAll('*').remove();

    const xScale = log
      ? d3.scaleLog().domain(extent).range([margin.left, margin.left + innerW])
      : d3.scaleLinear().domain(extent).range([margin.left, margin.left + innerW]);
    const yMax = d3.max(totalBins) ?? 1;
    const yScale = d3.scaleLinear().domain([0, yMax]).range([margin.top + innerH, margin.top]);

    const g = svg.append('g');

    // Background bars (unfiltered counts).
    g.selectAll<SVGRectElement, number>('rect.bg').data(totalBins).enter()
      .append('rect').attr('class', 'bg')
      .attr('x', (_d, i) => xScale(edges[i]!))
      .attr('y', d => yScale(d))
      .attr('width', (_d, i) => Math.max(1, xScale(edges[i + 1]!) - xScale(edges[i]!) - 1))
      .attr('height', d => yScale(0) - yScale(d))
      .attr('fill', 'rgba(124, 92, 255, 0.18)');

    // Foreground bars (filtered counts).
    g.selectAll<SVGRectElement, number>('rect.fg').data(filteredBins).enter()
      .append('rect').attr('class', 'fg')
      .attr('x', (_d, i) => xScale(edges[i]!))
      .attr('y', d => yScale(d))
      .attr('width', (_d, i) => Math.max(1, xScale(edges[i + 1]!) - xScale(edges[i]!) - 1))
      .attr('height', d => yScale(0) - yScale(d))
      .attr('fill', '#7c5cff');

    // X axis: show the two extremes only (saves space on small panels).
    const fmt = log ? d3.format('.2~s') : d3.format('.2~s');
    svg.append('g')
      .attr('transform', `translate(0,${margin.top + innerH})`)
      .call(d3.axisBottom(xScale).tickValues(extent).tickFormat(d => fmt(+d)))
      .call(s => s.select('.domain').remove())
      .selectAll('text').attr('class', 'tick-text');

    // Brush over the inner area.
    const brush = d3.brushX<unknown>()
      .extent([[margin.left, margin.top], [margin.left + innerW, margin.top + innerH]])
      .on('end', (event: d3.D3BrushEvent<unknown>) => {
        if (!event.sourceEvent) return; // programmatic brush; ignore
        if (!event.selection) {
          onFilterChange(dim, null);
          return;
        }
        const [x0, x1] = event.selection as [number, number];
        const v0 = +xScale.invert(x0);
        const v1 = +xScale.invert(x1);
        onFilterChange(dim, { kind: 'range', dim, min: Math.min(v0, v1), max: Math.max(v0, v1) });
      });

    const brushG = svg.append('g').attr('class', 'brush');
    brushG.call(brush);
    const cur = ctxRef.filters[dim];
    if (cur && cur.kind === 'range') {
      brushG.call(brush.move, [xScale(Math.max(cur.min, extent[0])), xScale(Math.min(cur.max, extent[1]))]);
    }
  }

  return {
    title: DIM_LABELS[dim],
    mount(container, ctx) {
      host = container;
      svg = null;
      ctxRef = ctx;
      render();
    },
    update(ctx) {
      ctxRef = ctx;
      render();
    },
    hasActiveFilter(filters) { return Boolean(filters[dim]); },
  };
}

function bin(values: readonly number[], edges: readonly number[]): number[] {
  const out = new Array(edges.length - 1).fill(0) as number[];
  for (const v of values) {
    if (v < edges[0]! || v > edges[edges.length - 1]!) continue;
    // Find bin index (linear scan; the bin count is small).
    for (let i = 0; i < out.length; i++) {
      if (v <= edges[i + 1]!) { out[i]!++; break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Categorical bar chart view (click to toggle membership in a set filter)
// ---------------------------------------------------------------------------

export function categoricalView(dim: CategoricalDim): ViewHandle {
  let host: HTMLElement | null = null;
  let ctxRef: ViewContext | null = null;

  function render(): void {
    if (!host || !ctxRef) return;
    const { all, filters, onFilterChange } = ctxRef;

    const counts = new Map<string, number>();
    for (const p of all) counts.set(p[dim] as string, (counts.get(p[dim] as string) ?? 0) + 1);
    const filtered = filterPlanets(all, filters, dim);
    const filteredCounts = new Map<string, number>();
    for (const p of filtered) filteredCounts.set(p[dim] as string, (filteredCounts.get(p[dim] as string) ?? 0) + 1);

    const cur = filters[dim];
    const selected = new Set<string>(cur && cur.kind === 'set' ? cur.values : []);

    const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = d3.max(cats, c => c[1]) ?? 1;

    host.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'cat-list';
    host.appendChild(ul);
    for (const [cat, total] of cats) {
      const li = document.createElement('li');
      const isSel = selected.size === 0 || selected.has(cat);
      li.className = `cat-item${isSel ? '' : ' dim'}${selected.has(cat) ? ' on' : ''}`;
      const n = filteredCounts.get(cat) ?? 0;
      li.innerHTML = `
        <span class="cat-label">${escapeHtml(cat)}</span>
        <span class="cat-bar"><span class="cat-bar-bg" style="width:${(total / max) * 100}%"></span><span class="cat-bar-fg" style="width:${(n / max) * 100}%"></span></span>
        <span class="cat-count">${n}</span>
      `;
      li.addEventListener('click', () => {
        const next = new Set(selected);
        if (next.has(cat)) next.delete(cat);
        else next.add(cat);
        onFilterChange(dim, next.size === 0 ? null : { kind: 'set', dim, values: [...next] });
      });
      ul.appendChild(li);
    }
  }

  return {
    title: DIM_LABELS[dim],
    mount(container, ctx) {
      host = container;
      ctxRef = ctx;
      render();
    },
    update(ctx) {
      ctxRef = ctx;
      render();
    },
    hasActiveFilter(filters) { return Boolean(filters[dim]); },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}
