/**
 * Choropleth example — shared US states choropleth using @polychrome/sdk
 *
 * Works standalone (local-only) when window.polychrome is absent.
 * When connected, year slider and pinned states are shared across peers.
 *
 * Data: US states TopoJSON from cdn.jsdelivr.net (us-atlas@3)
 * Color: synthetic value = (stateId * year) % 100
 */

import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { Topology, Objects, GeometryCollection } from 'topojson-specification';
import './style.css';

// Use minimal GeoJSON-compatible type
type GeoJsonProperties = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PolyApi {
  share<T>(key: string, initial?: T): {
    get(): T;
    set(value: T): void;
    subscribe(cb: (value: T) => void): () => void;
  };
  list<T>(listId: string): {
    get(): T[];
    insert(index: number, value: T): void;
    delete(index: number): void;
    subscribe(cb: (value: T[]) => void): () => void;
  };
  self: { actorId: string; name: string; color: string };
}

declare global {
  interface Window {
    polychrome?: PolyApi;
  }
}

// GeoJSON feature with numeric id
interface StateFeature extends GeoJSON.Feature<GeoJSON.MultiPolygon | GeoJSON.Polygon, GeoJsonProperties> {
  id?: string | number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const US_TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const MIN_YEAR = 1990;
const MAX_YEAR = 2020;

// State ID → name mapping (FIPS codes for US states)
const STATE_NAMES: Record<number, string> = {
  1: 'Alabama', 2: 'Alaska', 4: 'Arizona', 5: 'Arkansas', 6: 'California',
  8: 'Colorado', 9: 'Connecticut', 10: 'Delaware', 11: 'DC', 12: 'Florida',
  13: 'Georgia', 15: 'Hawaii', 16: 'Idaho', 17: 'Illinois', 18: 'Indiana',
  19: 'Iowa', 20: 'Kansas', 21: 'Kentucky', 22: 'Louisiana', 23: 'Maine',
  24: 'Maryland', 25: 'Massachusetts', 26: 'Michigan', 27: 'Minnesota',
  28: 'Mississippi', 29: 'Missouri', 30: 'Montana', 31: 'Nebraska', 32: 'Nevada',
  33: 'New Hampshire', 34: 'New Jersey', 35: 'New Mexico', 36: 'New York',
  37: 'North Carolina', 38: 'North Dakota', 39: 'Ohio', 40: 'Oklahoma',
  41: 'Oregon', 42: 'Pennsylvania', 44: 'Rhode Island', 45: 'South Carolina',
  46: 'South Dakota', 47: 'Tennessee', 48: 'Texas', 49: 'Utah', 50: 'Vermont',
  51: 'Virginia', 53: 'Washington', 54: 'West Virginia', 55: 'Wisconsin', 56: 'Wyoming',
};

// Synthetic value function
function syntheticValue(stateId: number, year: number): number {
  return (stateId * year) % 100;
}

// ---------------------------------------------------------------------------
// DOM setup
// ---------------------------------------------------------------------------

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="controls">
    <div class="control-group">
      <label for="year-slider">Year</label>
      <input type="range" id="year-slider" min="${MIN_YEAR}" max="${MAX_YEAR}" value="${MIN_YEAR}" step="1" />
      <span id="year-value">${MIN_YEAR}</span>
    </div>
  </div>
  <div id="main-content">
    <div id="map-area"></div>
    <div id="sidebar">
      <h3>Pinned States</h3>
      <ul id="pinned-list"></ul>
      <p class="empty-hint" id="pin-hint">Click a state to pin it.</p>
    </div>
  </div>
  <div id="status-badge">🔌 not connected to a session</div>
`;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentYear: number = MIN_YEAR;
let pinnedStateIds: number[] = [];

// Color scale (0..100)
const colorScale = d3.scaleSequential(d3.interpolateBlues).domain([0, 100]);

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const mapArea = document.getElementById('map-area')!;
const svg = d3.select('#map-area').append('svg')
  .attr('width', '100%')
  .attr('height', '100%');

const projection = d3.geoAlbersUsa();
const pathGen = d3.geoPath().projection(projection);

const statesGroup = svg.append('g').attr('class', 'states-group');
const bordersGroup = svg.append('g').attr('class', 'borders-group');

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderMap(): void {
  statesGroup.selectAll<SVGPathElement, StateFeature>('path.state')
    .attr('fill', (_d, _i, nodes) => {
      const el = nodes[_i] as SVGPathElement;
      const id = +(el.dataset['stateId'] ?? '0');
      return colorScale(syntheticValue(id, currentYear));
    })
    .classed('pinned', (_d, _i, nodes) => {
      const el = nodes[_i] as SVGPathElement;
      const id = +(el.dataset['stateId'] ?? '0');
      return pinnedStateIds.includes(id);
    });
}

function renderPinnedList(): void {
  const list = document.getElementById('pinned-list')!;
  const hint = document.getElementById('pin-hint')!;

  list.innerHTML = pinnedStateIds.map(id => {
    const name = STATE_NAMES[id] ?? `State ${id}`;
    return `<li data-state-id="${id}">
      <span>${name}</span>
      <button class="unpin-btn" title="Unpin">×</button>
    </li>`;
  }).join('');

  hint.style.display = pinnedStateIds.length === 0 ? 'block' : 'none';

  list.querySelectorAll<HTMLButtonElement>('.unpin-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('li') as HTMLLIElement;
      const id = +li.dataset['stateId']!;
      unpinState(id);
    });
  });
}

function fitMap(): void {
  const rect = mapArea.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  projection.fitSize([rect.width, rect.height], { type: 'Sphere' });
  // Refit all paths
  statesGroup.selectAll<SVGPathElement, StateFeature>('path.state')
    .attr('d', d => pathGen(d) ?? '');
  bordersGroup.selectAll<SVGPathElement, d3.GeoPermissibleObjects>('path.state-border')
    .attr('d', d => pathGen(d) ?? '');
}

// ---------------------------------------------------------------------------
// Pin/unpin
// ---------------------------------------------------------------------------

function pinState(id: number): void {
  if (pinnedStateIds.includes(id)) return;
  pinnedStateIds = [...pinnedStateIds, id];
  renderMap();
  renderPinnedList();

  if (window.polychrome) {
    const pinned = window.polychrome.list<number>('pinned');
    pinned.insert(pinned.get().length, id);
  }
}

function unpinState(id: number): void {
  const idx = pinnedStateIds.indexOf(id);
  if (idx === -1) return;
  pinnedStateIds = pinnedStateIds.filter(x => x !== id);
  renderMap();
  renderPinnedList();

  if (window.polychrome) {
    const pinned = window.polychrome.list<number>('pinned');
    const remoteIdx = pinned.get().indexOf(id);
    if (remoteIdx !== -1) {
      pinned.delete(remoteIdx);
    }
  }
}

// ---------------------------------------------------------------------------
// Year slider
// ---------------------------------------------------------------------------

const slider = document.getElementById('year-slider') as HTMLInputElement;
const yearDisplay = document.getElementById('year-value')!;

slider.addEventListener('input', () => {
  currentYear = +slider.value;
  yearDisplay.textContent = slider.value;
  renderMap();
  if (window.polychrome) {
    window.polychrome.share<number>('year').set(currentYear);
  }
});

// ---------------------------------------------------------------------------
// Load TopoJSON and draw map
// ---------------------------------------------------------------------------

async function loadMap(): Promise<void> {
  let topology: Topology<Objects<GeoJsonProperties>>;
  try {
    const res = await fetch(US_TOPOJSON_URL);
    topology = await res.json() as Topology<Objects<GeoJsonProperties>>;
  } catch {
    mapArea.innerHTML = '<p style="padding:32px;color:var(--r)">Failed to load map data. Check your network connection.</p>';
    return;
  }

  const statesObj = topology.objects['states'];
  if (!statesObj) return;
  const statesCollection = statesObj as GeometryCollection<GeoJsonProperties>;
  const stateFeatures = topojson.feature(topology, statesCollection);
  const statesArray: StateFeature[] =
    'features' in stateFeatures
      ? (stateFeatures.features as StateFeature[])
      : [stateFeatures as StateFeature];

  fitMap();

  statesGroup.selectAll<SVGPathElement, StateFeature>('path.state')
    .data(statesArray)
    .enter()
    .append('path')
    .attr('class', 'state')
    .attr('d', d => pathGen(d) ?? '')
    .attr('data-state-id', d => {
      return d.id != null ? String(d.id) : '0';
    })
    .on('click', (_event, d) => {
      const id = d.id != null ? +d.id : 0;
      if (pinnedStateIds.includes(id)) {
        unpinState(id);
      } else {
        pinState(id);
      }
    });

  // State borders
  const stateMesh = topojson.mesh(topology, statesCollection, (a, b) => a !== b);
  bordersGroup.append('path')
    .datum(stateMesh)
    .attr('class', 'state-border')
    .attr('d', d => pathGen(d) ?? '');

  renderMap();
  renderPinnedList();
  addLegend();
}

function addLegend(): void {
  const legendEl = document.createElement('div');
  legendEl.className = 'color-legend';

  const stops = 8;
  const barHtml = Array.from({ length: stops }, (_, i) => {
    const v = (i / (stops - 1)) * 100;
    return `<div style="flex:1;background:${colorScale(v)}"></div>`;
  }).join('');

  legendEl.innerHTML = `
    <div>Value (synthetic)</div>
    <div class="legend-bar">${barHtml}</div>
    <div class="legend-labels"><span>0</span><span>100</span></div>
  `;
  mapArea.style.position = 'relative';
  mapArea.appendChild(legendEl);
}

// ---------------------------------------------------------------------------
// SDK wiring
// ---------------------------------------------------------------------------

function initSdk(pc: PolyApi): void {
  document.getElementById('status-badge')!.textContent = '✓ connected to session';
  document.getElementById('status-badge')!.classList.add('connected');

  // Sync year
  const yearShared = pc.share<number>('year', MIN_YEAR);
  yearShared.subscribe((y) => {
    currentYear = y;
    slider.value = String(y);
    yearDisplay.textContent = String(y);
    renderMap();
  });

  // Sync pinned states
  const pinned = pc.list<number>('pinned');
  pinned.subscribe((ids) => {
    pinnedStateIds = [...ids];
    renderMap();
    renderPinnedList();
  });
}

// ---------------------------------------------------------------------------
// Resize + init
// ---------------------------------------------------------------------------

const ro = new ResizeObserver(() => fitMap());
ro.observe(mapArea);

window.addEventListener('DOMContentLoaded', () => {
  void loadMap();
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
