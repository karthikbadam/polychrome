/**
 * Scatterplot example - shared Iris dataset scatter plot using @polychrome/sdk
 *
 * Works standalone (local-only) when window.polychrome is absent.
 * When connected, four pieces of state are shared across peers:
 *   - axes.x         (Feature)              X axis selection
 *   - axes.y         (Feature)              Y axis selection
 *   - viewport.tx    ([k, x, y])            d3-zoom transform (data-independent)
 *   - selection.box  ([x0,y0,x1,y1] | null) brush extent in DATA coords
 */

import * as d3 from 'd3';
import './style.css';
import irisRaw from './iris.csv?raw';
import { installKiosk } from '@polychrome/kiosk';

installKiosk({ scope: 'scatterplot' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Feature = 'sepal_length' | 'sepal_width' | 'petal_length' | 'petal_width';

interface IrisRow {
  sepal_length: number;
  sepal_width: number;
  petal_length: number;
  petal_width: number;
  species: string;
  index: number;
}

// window.polychrome is declared globally by @polychrome/kiosk.

// ---------------------------------------------------------------------------
// Parse CSV
// ---------------------------------------------------------------------------

const data: IrisRow[] = d3.csvParse(irisRaw, (d, i) => ({
  sepal_length: +d['sepal_length']!,
  sepal_width: +d['sepal_width']!,
  petal_length: +d['petal_length']!,
  petal_width: +d['petal_width']!,
  species: d['species'] ?? '',
  index: i,
}));

// ---------------------------------------------------------------------------
// DOM scaffold
// ---------------------------------------------------------------------------

const FEATURES: Feature[] = ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'];
const FEATURE_LABELS: Record<Feature, string> = {
  sepal_length: 'Sepal Length',
  sepal_width: 'Sepal Width',
  petal_length: 'Petal Length',
  petal_width: 'Petal Width',
};

const SPECIES_COLORS: Record<string, string> = {
  setosa: '#7c5cff',
  versicolor: '#5cffb1',
  virginica: '#ff5c7c',
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="controls">
    <div class="control-group">
      <label for="x-axis">X axis</label>
      <select id="x-axis">
        ${FEATURES.map(f => `<option value="${f}"${f === 'sepal_length' ? ' selected' : ''}>${FEATURE_LABELS[f]}</option>`).join('')}
      </select>
    </div>
    <div class="control-group">
      <label for="y-axis">Y axis</label>
      <select id="y-axis">
        ${FEATURES.map(f => `<option value="${f}"${f === 'sepal_width' ? ' selected' : ''}>${FEATURE_LABELS[f]}</option>`).join('')}
      </select>
    </div>
    <button class="btn primary" id="btn-checkpoint">Checkpoint</button>
    <button class="btn" id="btn-reset">Reset view</button>
    <span class="hint">drag to pan, scroll to zoom, shift+drag to brush-select</span>
  </div>
  <div id="chart-area"></div>
`;

// ---------------------------------------------------------------------------
// Chart setup
// ---------------------------------------------------------------------------

const margin = { top: 24, right: 24, bottom: 48, left: 56 };
const chartEl = document.getElementById('chart-area')!;

let xFeature: Feature = 'sepal_length';
let yFeature: Feature = 'sepal_width';
/** Selected indices, derived from the brush box every render. */
let selectedIndices: number[] = [];
let currentTransform: d3.ZoomTransform = d3.zoomIdentity;
/** Active brush extent in DATA coords: [x0, y0, x1, y1]. null = no selection. */
let brushBox: [number, number, number, number] | null = null;

// Re-entrancy guards: when we apply a remote change, the local handlers
// must NOT echo it back as a fresh shared write. Otherwise a slow ping-pong
// builds up over the wire even with the kiosk's SELF_ORIGIN op-filter.
let applyingRemoteZoom = false;
let applyingRemoteAxes = false;
let applyingRemoteBrush = false;

const svg = d3.select('#chart-area')
  .append('svg')
  .attr('width', '100%')
  .attr('height', '100%');

const defs = svg.append('defs');
defs.append('clipPath')
  .attr('id', 'chart-clip')
  .append('rect')
  .attr('x', margin.left)
  .attr('y', margin.top);

const g = svg.append('g');
const dotsGroup = g.append('g').attr('clip-path', 'url(#chart-clip)');
const xAxisG = g.append('g').attr('class', 'axis x-axis');
const yAxisG = g.append('g').attr('class', 'axis y-axis');
const xLabel = g.append('text').attr('class', 'axis-label').attr('text-anchor', 'middle');
const yLabel = g.append('text').attr('class', 'axis-label').attr('text-anchor', 'middle');
const brushG = svg.append('g').attr('class', 'brush');

// Scales (rebuilt on every render so resize works)
let xScale = d3.scaleLinear();
let yScale = d3.scaleLinear();

function getSize(): { w: number; h: number } {
  const rect = chartEl.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function buildScales(w: number, h: number): void {
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  const xExtent = d3.extent(data, d => d[xFeature]) as [number, number];
  const yExtent = d3.extent(data, d => d[yFeature]) as [number, number];
  const xPad = (xExtent[1] - xExtent[0]) * 0.08;
  const yPad = (yExtent[1] - yExtent[0]) * 0.08;

  xScale = d3.scaleLinear()
    .domain([xExtent[0] - xPad, xExtent[1] + xPad])
    .range([margin.left, margin.left + innerW]);

  yScale = d3.scaleLinear()
    .domain([yExtent[0] - yPad, yExtent[1] + yPad])
    .range([margin.top + innerH, margin.top]);
}

function recomputeSelectionFromBrush(xs: d3.ScaleLinear<number, number>, ys: d3.ScaleLinear<number, number>): void {
  if (brushBox === null) {
    selectedIndices = [];
    return;
  }
  const [x0, y0, x1, y1] = brushBox;
  void xs; void ys;
  selectedIndices = data
    .filter(d =>
      d[xFeature] >= Math.min(x0, x1) && d[xFeature] <= Math.max(x0, x1) &&
      d[yFeature] >= Math.min(y0, y1) && d[yFeature] <= Math.max(y0, y1))
    .map(d => d.index);
}

function render(): void {
  const { w, h } = getSize();
  if (w === 0 || h === 0) return;

  defs.select('#chart-clip rect')
    .attr('width', w - margin.left - margin.right)
    .attr('height', h - margin.top - margin.bottom);

  buildScales(w, h);

  const tx = currentTransform;
  const xs = tx.rescaleX(xScale);
  const ys = tx.rescaleY(yScale);

  recomputeSelectionFromBrush(xs, ys);

  // Axes
  xAxisG.attr('transform', `translate(0,${h - margin.bottom})`).call(d3.axisBottom(xs).ticks(6));
  yAxisG.attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(ys).ticks(6));
  xLabel.attr('x', margin.left + (w - margin.left - margin.right) / 2).attr('y', h - 8).text(FEATURE_LABELS[xFeature]);
  yLabel.attr('transform', `rotate(-90)`).attr('x', -(margin.top + (h - margin.top - margin.bottom) / 2)).attr('y', 14).text(FEATURE_LABELS[yFeature]);

  // Dots
  const dots = dotsGroup.selectAll<SVGCircleElement, IrisRow>('circle.dot').data(data, d => d.index.toString());
  dots.enter()
    .append('circle')
    .attr('class', 'dot')
    .merge(dots)
    .attr('cx', d => xs(d[xFeature]))
    .attr('cy', d => ys(d[yFeature]))
    .attr('r', 5)
    .attr('fill', d => SPECIES_COLORS[d.species] ?? '#888')
    .attr('opacity', 0.85)
    .classed('dimmed', d => selectedIndices.length > 0 && !selectedIndices.includes(d.index))
    .classed('selected', d => selectedIndices.includes(d.index));
  dots.exit().remove();

  syncBrushVisualToBox(xs, ys);
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

const legendEl = document.createElement('div');
legendEl.className = 'legend';
legendEl.innerHTML = Object.entries(SPECIES_COLORS).map(([sp, color]) =>
  `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div><span>${sp}</span></div>`
).join('');
chartEl.style.position = 'relative';
chartEl.appendChild(legendEl);

// ---------------------------------------------------------------------------
// Zoom (drag = pan; scroll = zoom; shift = brush, gated by zoom.filter)
// ---------------------------------------------------------------------------

const zoom = d3.zoom<SVGSVGElement, unknown>()
  .scaleExtent([0.5, 20])
  .filter((event: Event) => !(event as MouseEvent | TouchEvent).shiftKey)
  .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
    currentTransform = event.transform;
    render();
    if (applyingRemoteZoom) return;
    if (window.polychrome) {
      // Send a compact [k, x, y] tuple to keep ops small.
      window.polychrome.share<[number, number, number]>('viewport.tx').set([
        currentTransform.k,
        currentTransform.x,
        currentTransform.y,
      ]);
    }
  });

svg.call(zoom);

document.getElementById('btn-reset')!.addEventListener('click', () => {
  svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  brushBox = null;
  if (window.polychrome) {
    window.polychrome.share<null>('selection.box').set(null);
  }
  render();
});

// ---------------------------------------------------------------------------
// Brush (shift+drag) - shares the extent in DATA coords
// ---------------------------------------------------------------------------

const brush = d3.brush<unknown>()
  .filter((event: Event) => (event as MouseEvent).shiftKey)
  .on('start brush end', (event: d3.D3BrushEvent<unknown>) => {
    const tx = currentTransform;
    const xs = tx.rescaleX(xScale);
    const ys = tx.rescaleY(yScale);

    if (event.selection === null) {
      brushBox = null;
    } else {
      const [[px0, py0], [px1, py1]] = event.selection as [[number, number], [number, number]];
      // Convert pixel extent back to data coords so it's invariant to zoom.
      brushBox = [xs.invert(px0), ys.invert(py0), xs.invert(px1), ys.invert(py1)];
    }
    render();

    if (event.type === 'end' && !applyingRemoteBrush) {
      if (window.polychrome) {
        window.polychrome.share<typeof brushBox>('selection.box').set(brushBox);
      }
    }
  });

function syncBrushVisualToBox(xs: d3.ScaleLinear<number, number>, ys: d3.ScaleLinear<number, number>): void {
  // Re-apply the brush to the chart-inner rect; brush extent has to use
  // pixel coords matching the current scales/zoom.
  const { w, h } = getSize();
  brush.extent([[margin.left, margin.top], [w - margin.right, h - margin.bottom]]);
  brushG.call(brush);
  if (brushBox === null) {
    // brush.move(null) would re-fire 'end' with selection=null; suppress
    // the local rebroadcast.
    applyingRemoteBrush = true;
    try { brushG.call(brush.move, null); } finally { applyingRemoteBrush = false; }
    return;
  }
  const [x0, y0, x1, y1] = brushBox;
  const px0 = xs(Math.min(x0, x1));
  const px1 = xs(Math.max(x0, x1));
  const py0 = ys(Math.max(y0, y1));
  const py1 = ys(Math.min(y0, y1));
  applyingRemoteBrush = true;
  try { brushG.call(brush.move, [[px0, py0], [px1, py1]]); } finally { applyingRemoteBrush = false; }
}

// ---------------------------------------------------------------------------
// Axis dropdowns
// ---------------------------------------------------------------------------

const xSel = document.getElementById('x-axis') as HTMLSelectElement;
const ySel = document.getElementById('y-axis') as HTMLSelectElement;

xSel.addEventListener('change', () => {
  xFeature = xSel.value as Feature;
  // Clear brush + zoom on axis change since data domain shifts.
  brushBox = null;
  applyingRemoteZoom = true;
  svg.call(zoom.transform, d3.zoomIdentity);
  applyingRemoteZoom = false;
  currentTransform = d3.zoomIdentity;
  render();
  if (applyingRemoteAxes) return;
  if (window.polychrome) {
    window.polychrome.share<Feature>('axes.x').set(xFeature);
    window.polychrome.share<typeof brushBox>('selection.box').set(null);
    window.polychrome.share<[number, number, number]>('viewport.tx').set([1, 0, 0]);
  }
});
ySel.addEventListener('change', () => {
  yFeature = ySel.value as Feature;
  brushBox = null;
  applyingRemoteZoom = true;
  svg.call(zoom.transform, d3.zoomIdentity);
  applyingRemoteZoom = false;
  currentTransform = d3.zoomIdentity;
  render();
  if (applyingRemoteAxes) return;
  if (window.polychrome) {
    window.polychrome.share<Feature>('axes.y').set(yFeature);
    window.polychrome.share<typeof brushBox>('selection.box').set(null);
    window.polychrome.share<[number, number, number]>('viewport.tx').set([1, 0, 0]);
  }
});

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

document.getElementById('btn-checkpoint')!.addEventListener('click', () => {
  if (window.polychrome) {
    window.polychrome.checkpoint('I see a cluster');
  }
});

// ---------------------------------------------------------------------------
// SDK wiring
// ---------------------------------------------------------------------------

function initSdk(pc: NonNullable<typeof window.polychrome>): void {
  // Axes
  pc.share<Feature>('axes.x', xFeature).subscribe((f) => {
    if (f === xFeature) return;
    applyingRemoteAxes = true;
    try {
      xFeature = f;
      xSel.value = f;
      brushBox = null;
      applyingRemoteZoom = true;
      svg.call(zoom.transform, d3.zoomIdentity);
      applyingRemoteZoom = false;
      currentTransform = d3.zoomIdentity;
      render();
    } finally {
      applyingRemoteAxes = false;
    }
  });
  pc.share<Feature>('axes.y', yFeature).subscribe((f) => {
    if (f === yFeature) return;
    applyingRemoteAxes = true;
    try {
      yFeature = f;
      ySel.value = f;
      brushBox = null;
      applyingRemoteZoom = true;
      svg.call(zoom.transform, d3.zoomIdentity);
      applyingRemoteZoom = false;
      currentTransform = d3.zoomIdentity;
      render();
    } finally {
      applyingRemoteAxes = false;
    }
  });

  // Viewport
  pc.share<[number, number, number]>('viewport.tx', [1, 0, 0]).subscribe(([k, x, y]) => {
    const t = d3.zoomIdentity.translate(x, y).scale(k);
    if (
      t.k === currentTransform.k &&
      t.x === currentTransform.x &&
      t.y === currentTransform.y
    ) return;
    applyingRemoteZoom = true;
    try {
      svg.call(zoom.transform, t);
      currentTransform = t;
      render();
    } finally {
      applyingRemoteZoom = false;
    }
  });

  // Brush selection (extent in DATA coords)
  pc.share<typeof brushBox>('selection.box', null).subscribe((box) => {
    brushBox = box;
    render();
  });
}

// ---------------------------------------------------------------------------
// Resize + init
// ---------------------------------------------------------------------------

const ro = new ResizeObserver(() => render());
ro.observe(chartEl);

window.addEventListener('DOMContentLoaded', () => {
  render();
  if (window.polychrome) initSdk(window.polychrome);
});

let sdkInitialized = false;
const checkInterval = setInterval(() => {
  if (window.polychrome && !sdkInitialized) {
    sdkInitialized = true;
    clearInterval(checkInterval);
    initSdk(window.polychrome);
  }
}, 250);

window.addEventListener('load', () => render());
