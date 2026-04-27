/**
 * bottom-bar.ts - shared wrapper that hosts the kiosk banner and the
 * ops-panel toggle as adjacent siblings.
 *
 * Both modules are independent: the kiosk runtime creates the banner,
 * the ops panel module creates the toggle. To keep them visually
 * stacked horizontally at the bottom-left (instead of pinned to
 * opposite corners and risking overlap on narrow screens), they share
 * one fixed-position flex container.
 *
 * Idempotent: first caller creates the bar; the rest reuse it.
 */

const BAR_ID = 'pc-kiosk-bottom-bar';
const STYLE_ID = 'pc-kiosk-bottom-bar-styles';

export function ensureBottomBar(doc: Document = document): HTMLElement {
  let bar = doc.getElementById(BAR_ID);
  if (bar) return bar;

  ensureStyles(doc);
  bar = doc.createElement('div');
  bar.id = BAR_ID;
  doc.body.appendChild(bar);
  return bar;
}

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BAR_ID} {
      position: fixed; left: 12px; bottom: 12px; z-index: 1000;
      max-width: calc(100vw - 24px);
      display: flex; align-items: stretch; gap: 8px; flex-wrap: nowrap;
      pointer-events: none;
    }
    #${BAR_ID} > * { pointer-events: auto; }
    @media (max-width: 480px) {
      #${BAR_ID} { left: 8px; bottom: 8px; gap: 6px; max-width: calc(100vw - 16px); }
    }
  `;
  doc.head.appendChild(style);
}
