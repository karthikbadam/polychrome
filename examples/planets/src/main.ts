/**
 * main.ts - Planets coordinated multi-view explorer.
 *
 * 9 views over a synthetic exoplanet dataset:
 *   1. discovery_method      (categorical bar)
 *   2. discovery_year        (histogram)
 *   3. distance_pc           (histogram, log)
 *   4. mass_earth            (histogram, log)
 *   5. radius_earth          (histogram)
 *   6. orbital_period_d      (histogram, log)
 *   7. host_star_temp_k      (histogram)
 *   8. semi_major_axis_au    (histogram, log)
 *   9. eq_temp_k             (histogram)
 *
 * Brushing any view writes a dimension-keyed filter into the shared
 * polychrome state at `filter.<dim>`. Other views re-render the
 * cross-filtered subset. The op definition is dimension/value based,
 * NOT screen pixel based, so peers on different display sizes /
 * orientations / display modes see the same logical selection.
 *
 * Two display modes:
 *  - desktop: 3x3 grid of all 9 views
 *  - mobile:  one focused view at a time + thumbnail pager
 *
 * Mode is auto-picked from window.innerWidth and can be flipped by a
 * toggle in the toolbar; the chosen mode is shared via polychrome so
 * a peer hitting "force grid" propagates that hint (peers can still
 * override locally).
 */

import './style.css';
import { installKiosk } from '@polychrome/kiosk';
import { PLANETS, DIMENSIONS, type Dim } from './data.js';
import {
  type FilterMap, type FilterValue, activeCount, compact,
} from './filters.js';
import { categoricalView, histogramView, type ViewHandle } from './views.js';

installKiosk({ scope: 'planets' });

// Build the 9 views once. The list is the canonical ordering used by
// both the desktop grid and the mobile pager.
const VIEWS: ViewHandle[] = [
  categoricalView('discovery_method'),
  ...DIMENSIONS.numeric.map(d => histogramView(d)),
];

// ---------------------------------------------------------------------------
// Local mirror of the shared filter state.
// ---------------------------------------------------------------------------

let filters: FilterMap = {};
let mode: 'desktop' | 'mobile' = window.innerWidth < 720 ? 'mobile' : 'desktop';
let mobileIndex = 0;

function setFilter(next: FilterValue): void {
  if (!next) return; // setFilter only called from views; clearAll handles null cases
  filters = { ...filters, [next.dim]: next };
  if (window.polychrome) {
    window.polychrome.share<FilterValue>(`filter.${next.dim}`).set(next);
  }
  scheduleRender();
}

function clearFilter(dim: string): void {
  if (!(dim in filters)) return;
  filters = { ...filters };
  delete (filters as Record<string, unknown>)[dim];
  if (window.polychrome) {
    window.polychrome.share<FilterValue>(`filter.${dim}`).set(null);
  }
  scheduleRender();
}

function clearAll(): void {
  for (const dim of Object.keys(filters)) clearFilter(dim);
}

// Coalesce many simultaneous updates (e.g., a brush drag fires repeatedly)
// into one render per frame.
let pending = false;
function scheduleRender(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const root = document.getElementById('app')!;
root.innerHTML = `
  <div id="planets-app">
    <header>
      <h1>Planets <span class="ver">explorer</span></h1>
      <div class="counts" id="counts"></div>
      <div class="actions">
        <button id="clear-all" class="btn">Clear filters</button>
        <div class="mode-toggle" role="tablist" aria-label="display mode">
          <button class="mode-btn" data-mode="desktop" aria-label="Grid">▦</button>
          <button class="mode-btn" data-mode="mobile"  aria-label="Pager">▤</button>
        </div>
      </div>
    </header>
    <main id="layout"></main>
  </div>
`;

document.getElementById('clear-all')!.addEventListener('click', clearAll);
for (const btn of document.querySelectorAll<HTMLButtonElement>('.mode-btn')) {
  btn.addEventListener('click', () => {
    mode = btn.dataset['mode'] as 'desktop' | 'mobile';
    render();
  });
}

const ro = new ResizeObserver(() => {
  // Only react to actual mode-flipping crossings; otherwise let the
  // existing layout re-render on next filter change.
  const next = window.innerWidth < 720 ? 'mobile' : 'desktop';
  if (next !== mode && !manualMode) { mode = next; render(); }
});
ro.observe(document.body);

let manualMode = false;
for (const btn of document.querySelectorAll<HTMLButtonElement>('.mode-btn')) {
  btn.addEventListener('click', () => { manualMode = true; });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const layout = document.getElementById('layout')!;
const containers: Map<ViewHandle, HTMLElement> = new Map();

function render(): void {
  // Update the toolbar.
  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset['mode'] === mode);
  });
  const total = PLANETS.length;
  const visible = PLANETS.filter(p => {
    for (const f of Object.values(filters)) {
      if (!f) continue;
      if (f.kind === 'range') { const v = p[f.dim] as number; if (v < f.min || v > f.max) return false; }
      else if (f.values.length > 0 && !f.values.includes(p[f.dim] as string)) return false;
    }
    return true;
  }).length;
  const ac = activeCount(filters);
  document.getElementById('counts')!.textContent =
    ac === 0 ? `${total} planets` : `${visible} / ${total} planets - ${ac} filter${ac > 1 ? 's' : ''}`;

  containers.clear();
  layout.innerHTML = '';
  layout.dataset['mode'] = mode;

  if (mode === 'desktop') renderGrid();
  else renderMobile();
}

function makeViewCard(view: ViewHandle): HTMLElement {
  const card = document.createElement('section');
  card.className = `view-card${view.hasActiveFilter(filters) ? ' active' : ''}`;
  card.innerHTML = `
    <header class="view-header">
      <span class="view-title">${view.title}</span>
      <button class="view-clear" title="Clear this filter">${view.hasActiveFilter(filters) ? '×' : ''}</button>
    </header>
    <div class="view-body"></div>
  `;
  const body = card.querySelector<HTMLElement>('.view-body')!;
  containers.set(view, body);
  card.querySelector<HTMLButtonElement>('.view-clear')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const dim = findDim(view);
    if (dim) clearFilter(dim);
  });
  return card;
}

function findDim(view: ViewHandle): string | null {
  // A view is uniquely identified by its title (DIM_LABELS is 1:1).
  // Look up the dim by inspecting the categorical/numeric dim list.
  for (const d of DIMENSIONS.categorical) {
    if (categoricalView(d).title === view.title) return d;
  }
  for (const d of DIMENSIONS.numeric) {
    if (histogramView(d).title === view.title) return d;
  }
  return null;
}

function renderGrid(): void {
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const v of VIEWS) grid.appendChild(makeViewCard(v));
  layout.appendChild(grid);
  for (const v of VIEWS) {
    const c = containers.get(v)!;
    v.mount(c, viewContext());
  }
}

function renderMobile(): void {
  const wrap = document.createElement('div');
  wrap.className = 'mobile-wrap';

  const v = VIEWS[mobileIndex] ?? VIEWS[0]!;
  const card = makeViewCard(v);
  card.classList.add('mobile-focused');
  wrap.appendChild(card);

  const pager = document.createElement('nav');
  pager.className = 'pager';
  for (let i = 0; i < VIEWS.length; i++) {
    const dot = document.createElement('button');
    dot.className = `pager-dot${i === mobileIndex ? ' active' : ''}${VIEWS[i]!.hasActiveFilter(filters) ? ' filtered' : ''}`;
    dot.title = VIEWS[i]!.title;
    dot.addEventListener('click', () => { mobileIndex = i; render(); });
    pager.appendChild(dot);
  }
  wrap.appendChild(pager);
  layout.appendChild(wrap);

  v.mount(containers.get(v)!, viewContext());
}

function viewContext() {
  return {
    all: PLANETS,
    filters,
    onFilterChange: (dim: Dim, next: FilterValue) => {
      if (next === null) clearFilter(dim);
      else setFilter(next);
    },
  };
}

// ---------------------------------------------------------------------------
// Polychrome wiring
// ---------------------------------------------------------------------------

function pickUpRemote(pc: NonNullable<typeof window.polychrome>): void {
  const subscribe = (dim: string): void => {
    pc.share<FilterValue>(`filter.${dim}`).subscribe((value) => {
      const next = { ...filters };
      if (value) next[dim as keyof FilterMap] = value;
      else delete (next as Record<string, unknown>)[dim];
      filters = compact(next);
      scheduleRender();
    });
  };
  for (const d of DIMENSIONS.numeric) subscribe(d);
  for (const d of DIMENSIONS.categorical) subscribe(d);
}

window.addEventListener('DOMContentLoaded', () => {
  render();
  if (window.polychrome) pickUpRemote(window.polychrome);
});

let pcInit = false;
const pcCheck = setInterval(() => {
  if (window.polychrome && !pcInit) {
    pcInit = true;
    clearInterval(pcCheck);
    pickUpRemote(window.polychrome);
  }
}, 250);
