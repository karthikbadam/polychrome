/**
 * Drawing example — shared whiteboard using @polychrome/sdk
 *
 * Works standalone (local-only) when window.polychrome is absent.
 * When connected, strokes are shared across peers via the 'strokes' list.
 */

import './style.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  color: string;
  points: Point[];
}

// Minimal SDK surface we need (duck-typed so we don't import the full SDK
// in the module graph — it's injected by the extension bridge on window).
interface PolyApi {
  list<T>(listId: string): {
    get(): T[];
    insert(index: number, value: T): void;
    delete(index: number): void;
    subscribe(cb: (value: T[]) => void): () => void;
  };
  share<T>(key: string, initial?: T): {
    get(): T;
    set(value: T): void;
    subscribe(cb: (value: T) => void): () => void;
  };
  self: { actorId: string; name: string; color: string };
}

declare global {
  interface Window {
    polychrome?: PolyApi;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PALETTE = [
  '#ff5c7c', // red
  '#ffc857', // yellow
  '#5cffb1', // green
  '#5ccfff', // blue
  '#7c5cff', // purple
  '#ff9f5c', // orange
  '#ff5cf0', // pink
  '#e8eaed', // white/light
];

// ---------------------------------------------------------------------------
// DOM setup
// ---------------------------------------------------------------------------

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="canvas-container">
    <canvas id="drawing-canvas"></canvas>
  </div>
  <div id="toolbar">
    <span class="toolbar-label">Color</span>
    ${PALETTE.map((c, i) => `<button class="color-swatch${i === 0 ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
    <div class="toolbar-sep"></div>
    <button class="btn-clear" id="btn-clear">Clear</button>
  </div>
  <div id="status-badge">🔌 not connected to a session</div>
  <div id="actor-info" style="display:none"></div>
`;

const canvas = document.getElementById('drawing-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const statusBadge = document.getElementById('status-badge')!;
const actorInfo = document.getElementById('actor-info')!;

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------

function resizeCanvas(): void {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = width;
  canvas.height = height;
  redrawAll();
}

window.addEventListener('resize', resizeCanvas);

// ---------------------------------------------------------------------------
// Stroke state
// ---------------------------------------------------------------------------

let allStrokes: Stroke[] = [];
let currentColor: string = PALETTE[0] ?? '#ff5c7c';
let isDrawing = false;
let currentPoints: Point[] = [];

function redrawAll(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of allStrokes) {
    drawStroke(stroke);
  }
}

function drawStroke(stroke: Stroke): void {
  if (stroke.points.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const first = stroke.points[0]!;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < stroke.points.length; i++) {
    const pt = stroke.points[i]!;
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();
}

function drawLivePoint(pt: Point): void {
  if (currentPoints.length === 0) return;
  const last = currentPoints[currentPoints.length - 1]!;
  ctx.beginPath();
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(pt.x, pt.y);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('.color-swatch').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelector('.color-swatch.active')?.classList.remove('active');
    btn.classList.add('active');
    currentColor = btn.dataset['color'] ?? currentColor;
  });
});

// ---------------------------------------------------------------------------
// Pointer events
// ---------------------------------------------------------------------------

function getPos(e: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e: PointerEvent) => {
  canvas.setPointerCapture(e.pointerId);
  isDrawing = true;
  currentPoints = [getPos(e)];
});

canvas.addEventListener('pointermove', (e: PointerEvent) => {
  if (!isDrawing) return;
  const pt = getPos(e);
  drawLivePoint(pt);
  currentPoints.push(pt);
});

canvas.addEventListener('pointerup', () => {
  if (!isDrawing) return;
  isDrawing = false;
  if (currentPoints.length >= 2) {
    const stroke: Stroke = { color: currentColor, points: [...currentPoints] };
    allStrokes.push(stroke);
    // Share via SDK if available
    if (window.polychrome) {
      const strokes = window.polychrome.list<Stroke>('strokes');
      strokes.insert(strokes.get().length, stroke);
    }
  }
  currentPoints = [];
});

canvas.addEventListener('pointercancel', () => {
  isDrawing = false;
  currentPoints = [];
  redrawAll();
});

// ---------------------------------------------------------------------------
// Clear button
// ---------------------------------------------------------------------------

document.getElementById('btn-clear')!.addEventListener('click', () => {
  allStrokes = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (window.polychrome) {
    const strokes = window.polychrome.list<Stroke>('strokes');
    // Delete from end to start to avoid index shifting
    const len = strokes.get().length;
    for (let i = len - 1; i >= 0; i--) {
      strokes.delete(i);
    }
  }
});

// ---------------------------------------------------------------------------
// SDK wiring
// ---------------------------------------------------------------------------

function initSdk(pc: PolyApi): void {
  statusBadge.textContent = '✓ connected to session';
  statusBadge.classList.add('connected');

  actorInfo.style.display = 'block';
  actorInfo.textContent = `You: ${pc.self.name}`;
  actorInfo.style.borderColor = pc.self.color;

  // Auto-select actor's color if it's in the palette
  if (PALETTE.includes(pc.self.color)) {
    currentColor = pc.self.color;
    document.querySelector('.color-swatch.active')?.classList.remove('active');
    const sw = document.querySelector<HTMLButtonElement>(`.color-swatch[data-color="${pc.self.color}"]`);
    if (sw) sw.classList.add('active');
  }

  const strokes = pc.list<Stroke>('strokes');

  // Subscribe to remote stroke updates
  strokes.subscribe((newStrokes) => {
    allStrokes = newStrokes;
    redrawAll();
  });
}

// Detect extension on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  if (window.polychrome) {
    initSdk(window.polychrome);
  }
});

// Also watch for late injection (extension may inject after page load)
let sdkInitialized = false;
const checkInterval = setInterval(() => {
  if (window.polychrome && !sdkInitialized) {
    sdkInitialized = true;
    clearInterval(checkInterval);
    initSdk(window.polychrome);
  }
}, 250);

// Fallback: initial canvas resize on load
window.addEventListener('load', () => {
  resizeCanvas();
});
