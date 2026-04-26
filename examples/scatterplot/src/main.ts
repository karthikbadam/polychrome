/**
 * Scatterplot example - shared Iris dataset scatter plot.
 *
 * Works standalone (local-only) when window.polychrome is absent.
 * When connected, three pieces of state are shared across peers:
 *   - axes.x         (Feature)              X axis selection
 *   - axes.y         (Feature)              Y axis selection
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

type BrushBox = [number, number, number, number] | null;

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
    <button class="btn" id="btn-clear">Clear selection</button>
    <span class="hint">drag to brush-select points</span>
  </div>
  <div id="chart-area"></div>
`;

// ---------------------------------------------------------------------------
// Chart state
// ---------------------------------------------------------------------------

const margin = { top: 24, right: 24, bottom: 48, left: 56 };
const chartEl = document.getElementById('chart-area')!;

let xFeature: Feature = 'sepal_length';
let yFeature: Feature = 'sepal_width';
let selectedIndices: number[] = [];
/** Active brush extent in DATA coords. Null = no selection. */
let brushBox: BrushBox = null;

/**
 * Set true while we're programmatically updating the brush from a
 * remote/cleared/reset state. The brush event handler bails out early so
 * those programmatic moves do NOT broadcast.
 */
let applyingRemoteBrush = false;
let applyingRemoteAxes = false;

let onLocalBrushEnd: ((box: BrushBox) => void) | null = null;
let onLocalAxesChange: ((x: Feature, y: Feature) => void) | null = null;

// ---------------------------------------------------------------------------
// SVG scaffolding
// ---------------------------------------------------------------------------

const svg = d3.select('#chart-area')
  .append('svg')
  .attr('width', '100%')
  .attr('height', '100%');

const g = svg.append('g');
const dotsGroup = g.append('g');
const xAxisG = g.append('g').attr('class', 'axis x-axis');
const yAxisG = g.append('g').attr('class', 'axis y-axis');
const xLabel = g.append('text').attr('class', 'axis-label').attr('text-anchor', 'middle');
const yLabel = g.append('text').attr('class', 'axis-label').attr('text-anchor', 'middle');
const brushG = svg.append('g').attr('class', 'brush');

let xScale = d3.scaleLinear();
let yScale = d3.scaleLinear();

// ---------------------------------------------------------------------------
// d3-brush - one global brush behavior, re-extent'd on resize.
// ---------------------------------------------------------------------------

const brush = d3.brush<unknown>().on('start brush end', (event: d3.D3BrushEvent<unknown>) => {
  // Programmatic brush.move() (remote sync, clear, axis change) sets
  // applyingRemoteBrush=true around the call. Skip the handler entirely
  // so we never re-broadcast or recurse.
  if (applyingRemoteBrush) return;

  if (event.selection === null) {
    brushBox = null;
  } else {
    const [[px0, py0], [px1, py1]] = event.selection as [[number, number], [number, number]];
    brushBox = [xScale.invert(px0), yScale.invert(py0), xScale.invert(px1), yScale.invert(py1)];
  }
  updateHighlight();

  if (event.type === 'end' && onLocalBrushEnd) onLocalBrushEnd(brushBox);
});

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

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
  xScale = d3.scaleLinear().domain([xExtent[0] - xPad, xExtent[1] + xPad]).range([margin.left, margin.left + innerW]);
  yScale = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).range([margin.top + innerH, margin.top]);
}

function recomputeSelection(): void {
  if (brushBox === null) { selectedIndices = []; return; }
  const [x0, y0, x1, y1] = brushBox;
  selectedIndices = data
    .filter(d =>
      d[xFeature] >= Math.min(x0, x1) && d[xFeature] <= Math.max(x0, x1) &&
      d[yFeature] >= Math.min(y0, y1) && d[yFeature] <= Math.max(y0, y1))
    .map(d => d.index);
}

// ---------------------------------------------------------------------------
// Render passes
// ---------------------------------------------------------------------------

/** Full chart render: scales, axes, labels, dot positions, brush extent. */
function renderChart(): void {
  const { w, h } = getSize();
  if (w === 0 || h === 0) return;

  buildScales(w, h);

  xAxisG.attr('transform', `translate(0,${h - margin.bottom})`).call(d3.axisBottom(xScale).ticks(6));
  yAxisG.attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(yScale).ticks(6));
  xLabel.attr('x', margin.left + (w - margin.left - margin.right) / 2).attr('y', h - 8).text(FEATURE_LABELS[xFeature]);
  yLabel.attr('transform', `rotate(-90)`).attr('x', -(margin.top + (h - margin.top - margin.bottom) / 2)).attr('y', 14).text(FEATURE_LABELS[yFeature]);

  const dots = dotsGroup.selectAll<SVGCircleElement, IrisRow>('circle.dot').data(data, d => d.index.toString());
  dots.enter()
    .append('circle')
    .attr('class', 'dot')
    .attr('r', 5)
    .attr('fill', d => SPECIES_COLORS[d.species] ?? '#888')
    .merge(dots)
    .attr('cx', d => xScale(d[xFeature]))
    .attr('cy', d => yScale(d[yFeature]));
  dots.exit().remove();

  // Re-extent the brush behavior to the new chart size.
  brush.extent([[margin.left, margin.top], [w - margin.right, h - margin.bottom]]);
  brushG.call(brush);

  drawBrushFromState();
  updateHighlight();
}

/** Update only dot dim/highlight classes based on current selection. */
function updateHighlight(): void {
  recomputeSelection();
  dotsGroup.selectAll<SVGCircleElement, IrisRow>('circle.dot')
    .classed('dimmed', d => selectedIndices.length > 0 && !selectedIndices.includes(d.index))
    .classed('selected', d => selectedIndices.includes(d.index));
}

/** Programmatically position the brush rectangle from `brushBox`. */
function drawBrushFromState(): void {
  applyingRemoteBrush = true;
  try {
    if (brushBox === null) {
      brushG.call(brush.move, null);
    } else {
      const [x0, y0, x1, y1] = brushBox;
      const px0 = xScale(Math.min(x0, x1));
      const px1 = xScale(Math.max(x0, x1));
      const py0 = yScale(Math.max(y0, y1));
      const py1 = yScale(Math.min(y0, y1));
      brushG.call(brush.move, [[px0, py0], [px1, py1]]);
    }
  } finally {
    applyingRemoteBrush = false;
  }
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
// Axis dropdowns
// ---------------------------------------------------------------------------

const xSel = document.getElementById('x-axis') as HTMLSelectElement;
const ySel = document.getElementById('y-axis') as HTMLSelectElement;

function changeAxes(nextX: Feature, nextY: Feature, broadcast: boolean): void {
  const axesChanged = nextX !== xFeature || nextY !== yFeature;
  xFeature = nextX; yFeature = nextY;
  xSel.value = nextX; ySel.value = nextY;
  if (axesChanged) brushBox = null;
  renderChart();
  if (broadcast && onLocalAxesChange) onLocalAxesChange(xFeature, yFeature);
}

xSel.addEventListener('change', () => changeAxes(xSel.value as Feature, yFeature, !applyingRemoteAxes));
ySel.addEventListener('change', () => changeAxes(xFeature, ySel.value as Feature, !applyingRemoteAxes));

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

document.getElementById('btn-clear')!.addEventListener('click', () => {
  brushBox = null;
  drawBrushFromState();
  updateHighlight();
  if (onLocalBrushEnd) onLocalBrushEnd(null);
});

document.getElementById('btn-checkpoint')!.addEventListener('click', () => {
  if (window.polychrome) window.polychrome.checkpoint('I see a cluster');
});

// ---------------------------------------------------------------------------
// SDK wiring
// ---------------------------------------------------------------------------

function initSdk(pc: NonNullable<typeof window.polychrome>): void {
  const xShared = pc.share<Feature>('axes.x', xFeature);
  const yShared = pc.share<Feature>('axes.y', yFeature);
  const boxShared = pc.share<BrushBox>('selection.box', null);

  // Local broadcasts
  onLocalAxesChange = (x, y) => { xShared.set(x); yShared.set(y); boxShared.set(null); };
  onLocalBrushEnd = (box) => { boxShared.set(box); };

  // Remote applies
  xShared.subscribe((f) => {
    if (f === xFeature) return;
    applyingRemoteAxes = true;
    try { changeAxes(f, yFeature, false); } finally { applyingRemoteAxes = false; }
  });
  yShared.subscribe((f) => {
    if (f === yFeature) return;
    applyingRemoteAxes = true;
    try { changeAxes(xFeature, f, false); } finally { applyingRemoteAxes = false; }
  });
  boxShared.subscribe((box) => {
    // Equal? skip.
    const eq =
      (box === null && brushBox === null) ||
      (Array.isArray(box) && Array.isArray(brushBox) &&
       box[0] === brushBox[0] && box[1] === brushBox[1] &&
       box[2] === brushBox[2] && box[3] === brushBox[3]);
    if (eq) return;
    brushBox = box;
    drawBrushFromState();
    updateHighlight();
  });
}

// ---------------------------------------------------------------------------
// Resize + init
// ---------------------------------------------------------------------------

const ro = new ResizeObserver(() => renderChart());
ro.observe(chartEl);

window.addEventListener('DOMContentLoaded', () => {
  renderChart();
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

window.addEventListener('load', () => renderChart());
