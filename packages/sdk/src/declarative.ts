/**
 * declarative.ts — data-pc-* attribute scanner
 *
 * Scans the DOM for elements tagged with data-pc-* attributes and
 * auto-wires them to the SDK:
 *
 *   data-pc-share="key"        — two-way bind to a shared key
 *   data-pc-checkpoint="label" — click fires a checkpoint
 *   data-pc-list="listId"      — subscribe to a SharedList (read-only display)
 *
 * Runs on DOMContentLoaded and sets up a MutationObserver for dynamic inserts.
 */

import { makeLogger } from '@polychrome/protocol';

import type { PolyChromeApi } from './api.js';

const log = makeLogger('sdk:declarative');

/** Internal bookkeeping so we don't double-wire an element. */
const wired = new WeakSet<Element>();

// ---------------------------------------------------------------------------
// Element wiring
// ---------------------------------------------------------------------------

function wireShare(el: Element, api: PolyChromeApi): void {
  const key = el.getAttribute('data-pc-share');
  if (!key) return;

  const shared = api.share<string>(key);

  // Pull current value into DOM immediately
  const current = shared.get();
  if (current !== undefined && current !== null) {
    setElementValue(el, String(current));
  }

  // DOM → bridge
  const domListener = (): void => {
    const val = getElementValue(el);
    log.debug('declarative share set', key, val);
    shared.set(val);
  };
  el.addEventListener('input', domListener);
  el.addEventListener('change', domListener);

  // Bridge → DOM
  shared.subscribe((val) => {
    const strVal = val !== undefined && val !== null ? String(val) : '';
    setElementValue(el, strVal);
  });
}

function wireCheckpoint(el: Element, api: PolyChromeApi): void {
  const label = el.getAttribute('data-pc-checkpoint');
  if (!label) return;

  el.addEventListener('click', () => {
    log.debug('declarative checkpoint', label);
    api.checkpoint(label);
  });
}

function wireList(el: Element, api: PolyChromeApi): void {
  const listId = el.getAttribute('data-pc-list');
  if (!listId) return;

  const sharedList = api.list<unknown>(listId);

  const render = (items: unknown[]): void => {
    // Re-render child <li> elements based on current list state
    const tagName = el.tagName.toLowerCase();
    if (tagName === 'ul' || tagName === 'ol') {
      // Remove existing managed children (those without data-pc-static)
      const existing = Array.from(el.children).filter(
        (c) => !c.hasAttribute('data-pc-static')
      );
      for (const child of existing) el.removeChild(child);

      // Append new items
      for (const item of items) {
        const li = document.createElement('li');
        li.textContent = item !== null && item !== undefined ? String(item) : '';
        el.appendChild(li);
      }
    }
  };

  // Render current state
  render(sharedList.get());

  // Subscribe to future changes
  sharedList.subscribe((items) => render(items));
}

// ---------------------------------------------------------------------------
// Value helpers for input-like elements
// ---------------------------------------------------------------------------

function getElementValue(el: Element): string {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return String(el.checked);
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  return el.textContent ?? '';
}

function setElementValue(el: Element, value: string): void {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') {
      el.checked = value === 'true';
    } else {
      el.value = value;
    }
  } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = value;
  } else {
    el.textContent = value;
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function wireElement(el: Element, api: PolyChromeApi): void {
  if (wired.has(el)) return;
  wired.add(el);

  if (el.hasAttribute('data-pc-share')) wireShare(el, api);
  if (el.hasAttribute('data-pc-checkpoint')) wireCheckpoint(el, api);
  if (el.hasAttribute('data-pc-list')) wireList(el, api);
}

function scanRoot(root: Element | Document, api: PolyChromeApi): void {
  const candidates = root.querySelectorAll(
    '[data-pc-share],[data-pc-checkpoint],[data-pc-list]'
  );

  for (const el of candidates) {
    wireElement(el, api);
  }
}

// ---------------------------------------------------------------------------
// Public: initDeclarative — call once per page with the api instance
// ---------------------------------------------------------------------------

/**
 * Start the declarative scanner.  Wires all currently present data-pc-*
 * elements and observes for dynamic insertions.
 */
export function initDeclarative(api: PolyChromeApi): void {
  const doScan = (): void => scanRoot(document, api);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doScan, { once: true });
  } else {
    doScan();
  }

  // Observe future DOM mutations
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          wireElement(el, api);
          // Also scan descendants
          scanRoot(el, api);
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  log.debug('declarative scanner active');
}
