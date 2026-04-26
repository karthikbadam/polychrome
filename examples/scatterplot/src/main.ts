/**
 * Scatterplot example — shared Iris dataset scatter plot using @polychrome/sdk
 *
 * Works standalone (local-only) when window.polychrome is absent.
 * When connected, zoom/pan transform and lasso selection are shared.
 */

import * as d3 from 'd3';
import './style.css';
import irisRaw from './iris.csv?raw';
import { installKiosk } from '@polychrome/kiosk';

// Self-host transport so demos work without the extension.
// Each demo is its own room scope; ?room= URL param picks the session.
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
  </div>
  <div id="chart-area"></div>
  <div id="status-badge">🔌 not connected to a session</div>
`;

// ---------------------------------------------------------------------------
// Chart setup
// ---------------------------------------------------------------------------

const margin = { top: 24, right: 24, bottom: 48, left: 56 };
const chartEl = document.getElementById('chart-area')!;

let xFeature: Feature = 'sepal_length';
let yFeature: Feature = 'sepal_width';
let selectedIndices: number[] = [];
let currentTransform: d3.ZoomTransform = d3.zoomIdentity;

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
const lassoPath = svg.append('path').attr('class', 'lasso-path');

// Scales
let xScale = d3.scaleLinear();
let yScale = d3.scaleLinear();

function getSize(): { w: number; h: number } {
  const rect = chartEl.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function updateClip(w: number, h: number): void {
  defs.select('#chart-clip rect')
    .attr('width', w - margin.left - margin.right)
    .attr('height', h - margin.top - margin.bottom);
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

function render(): void {
  const { w, h } = getSize();
  if (w === 0 || h === 0) return;

  updateClip(w, h);
  buildScales(w, h);

  const tx = currentTransform;
  const xs = tx.rescaleX(xScale);
  const ys = tx.rescaleY(yScale);

  // Axes
  const xAx = d3.axisBottom(xs).ticks(6);
  const yAx = d3.axisLeft(ys).ticks(6);

  xAxisG
    .attr('transform', `translate(0,${h - margin.bottom})`)
    .call(xAx);

  yAxisG
    .attr('transform', `translate(${margin.left},0)`)
    .call(yAx);

  xLabel
    .attr('x', margin.left + (w - margin.left - margin.right) / 2)
    .attr('y', h - 8)
    .text(FEATURE_LABELS[xFeature]);

  yLabel
    .attr('transform', `rotate(-90)`)
    .attr('x', -(margin.top + (h - margin.top - margin.bottom) / 2))
    .attr('y', 14)
    .text(FEATURE_LABELS[yFeature]);

  // Dots
  const dots = dotsGroup.selectAll<SVGCircleElement, IrisRow>('circle.dot')
    .data(data, d => d.index.toString());

  dots.enter()
    .append('circle')
    .attr('class', 'dot')
    .merge(dots)
    .attr('cx', d => xs(d[xFeature]))
    .attr('cy', d => ys(d[yFeature]))
    .attr('r', 5)
    .attr('fill', d => SPECIES_COLORS[d.species] ?? '#888')
    .attr('opacity', 0.8)
    .classed('dimmed', d => selectedIndices.length > 0 && !selectedIndices.includes(d.index))
    .classed('selected', d => selectedIndices.includes(d.index));

  dots.exit().remove();
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
// Zoom
// ---------------------------------------------------------------------------

const zoom = d3.zoom<SVGSVGElement, unknown>()
  .scaleExtent([0.5, 20])
  .filter((event) => !event.shiftKey) // shift is for lasso
  .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
    currentTransform = event.transform;
    render();
    if (window.polychrome) {
      const vp = window.polychrome.share<string>('viewport.transform');
      vp.set(currentTransform.toString());
    }
  });

svg.call(zoom);

document.getElementById('btn-reset')!.addEventListener('click', () => {
  svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
});

// ---------------------------------------------------------------------------
// Lasso selection (shift+drag)
// ---------------------------------------------------------------------------

let lassoPoints: [number, number][] = [];
let lassoActive = false;

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0], yi = polygon[i]![1];
    const xj = polygon[j]![0], yj = polygon[j]![1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

svg.on('pointerdown.lasso', (event: PointerEvent) => {
  if (!event.shiftKey) return;
  event.preventDefault();
  lassoActive = true;
  lassoPoints = [[event.offsetX, event.offsetY]];
  lassoPath.attr('d', '');
});

svg.on('pointermove.lasso', (event: PointerEvent) => {
  if (!lassoActive) return;
  lassoPoints.push([event.offsetX, event.offsetY]);
  if (lassoPoints.length > 1) {
    const lineGen = d3.line<[number, number]>().x(d => d[0]).y(d => d[1]).curve(d3.curveCatmullRom);
    lassoPath.attr('d', lineGen(lassoPoints) ?? '');
  }
});

svg.on('pointerup.lasso', () => {
  if (!lassoActive) return;
  lassoActive = false;
  lassoPath.attr('d', '');

  if (lassoPoints.length < 3) {
    selectedIndices = [];
    render();
    return;
  }

  const tx = currentTransform;
  const xs = tx.rescaleX(xScale);
  const ys = tx.rescaleY(yScale);

  selectedIndices = data
    .filter(d => pointInPolygon([xs(d[xFeature]), ys(d[yFeature])], lassoPoints))
    .map(d => d.index);

  render();
  lassoPoints = [];

  if (window.polychrome) {
    const sel = window.polychrome.share<number[]>('selection.indices');
    sel.set(selectedIndices);
  }
});

// ---------------------------------------------------------------------------
// Axis dropdowns
// ---------------------------------------------------------------------------

document.getElementById('x-axis')!.addEventListener('change', (e) => {
  xFeature = (e.target as HTMLSelectElement).value as Feature;
  currentTransform = d3.zoomIdentity;
  svg.call(zoom.transform, d3.zoomIdentity);
  render();
});

document.getElementById('y-axis')!.addEventListener('change', (e) => {
  yFeature = (e.target as HTMLSelectElement).value as Feature;
  currentTransform = d3.zoomIdentity;
  svg.call(zoom.transform, d3.zoomIdentity);
  render();
});

// ---------------------------------------------------------------------------
// Checkpoint button
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
  document.getElementById('status-badge')!.textContent = '✓ connected to session';
  document.getElementById('status-badge')!.classList.add('connected');

  // Sync viewport transform
  const vp = pc.share<string>('viewport.transform', d3.zoomIdentity.toString());
  vp.subscribe((transformStr) => {
    try {
      // Parse "translate(x,y) scale(k)" into a ZoomTransform
      const m = /translate\(([^,]+),([^)]+)\)\s*scale\(([^)]+)\)/.exec(transformStr);
      if (m) {
        const t = d3.zoomIdentity.translate(+m[1]!, +m[2]!).scale(+m[3]!);
        currentTransform = t;
        svg.call(zoom.transform, t);
        render();
      }
    } catch {
      // ignore parse errors
    }
  });

  // Sync selection
  const sel = pc.share<number[]>('selection.indices', []);
  sel.subscribe((indices) => {
    selectedIndices = indices;
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
  if (window.polychrome) {
    initSdk(window.polychrome);
  }
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
