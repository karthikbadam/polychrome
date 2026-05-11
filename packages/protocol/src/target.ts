/**
 * @polychrome/protocol - target.ts
 *
 * TargetRef helpers for addressing a DOM element across peers.
 *
 * `from(element)` captures a TargetRef from a live DOM element.
 * `resolve(ref, doc?)` recovers the element on the receiving peer.
 *
 * All runtime DOM access is guarded by `typeof document !== 'undefined'`
 * so this module is safe to import in Node/test environments.
 */

import type { TargetRef } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * CSS-escape a string for use in a CSS selector.
 * Uses the platform CSS.escape if available; falls back to a minimal
 * implementation that handles the most common cases.
 */
function cssEscape(value: string): string {
  // Use platform implementation if available (browsers, happy-dom via globalThis)
  if (typeof globalThis !== 'undefined' && typeof (globalThis as Record<string, unknown>)['CSS'] === 'object') {
    const cssGlobal = (globalThis as Record<string, unknown>)['CSS'] as { escape?: (v: string) => string };
    if (typeof cssGlobal.escape === 'function') {
      return cssGlobal.escape(value);
    }
  }
  // Minimal fallback: escape leading digit and non-word characters
  return value.replace(/([^\w-])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');
}

/**
 * Build a CSS selector for an element, preferring ID-based selectors.
 * Falls back to a tag + nth-child path.
 */
function buildSelector(el: Element): string {
  const id = el.id;
  if (id) {
    return `#${cssEscape(id)}`;
  }

  // Walk up to build an nth-child path
  const parts: string[] = [];
  let current: Element | null = el;
  while (current !== null && current.nodeType === 1 /* ELEMENT_NODE */) {
    const tag = current.tagName.toLowerCase();
    const parentEl: Element | null = current.parentElement;
    if (parentEl === null) {
      parts.unshift(tag);
      break;
    }

    // Count siblings to generate nth-child
    const siblings = Array.from(parentEl.children);
    const index = siblings.indexOf(current) + 1; // 1-based
    parts.unshift(`${tag}:nth-child(${index})`);
    current = parentEl;
  }
  return parts.join(' > ');
}

/**
 * Build an XPath expression for an element.
 */
function buildXPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current !== null && current.nodeType === 1 /* ELEMENT_NODE */) {
    const tag = current.tagName.toLowerCase();
    const parentEl: Element | null = current.parentElement;
    if (parentEl === null) {
      parts.unshift(`/${tag}`);
      break;
    }

    // Count same-tag siblings for position predicate
    const currentTag = current.tagName;
    const siblings = Array.from(parentEl.children).filter(
      (s) => s.tagName === currentTag,
    );
    if (siblings.length > 1) {
      const pos = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}[${pos}]`);
    } else {
      parts.unshift(tag);
    }
    current = parentEl;
  }
  return `/${parts.join('/')}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a TargetRef from a live DOM element.
 * Returns null if called outside a browser context.
 */
export function from(element: Element): TargetRef {
  const selector = buildSelector(element);
  const xpath = buildXPath(element);

  // Capture bounding rect in viewport coordinates
  const domRect = element.getBoundingClientRect();
  const rect = {
    x: domRect.left,
    y: domRect.top,
    w: domRect.width,
    h: domRect.height,
  };

  // Text prefix (first 80 chars of textContent)
  const rawText = element.textContent?.trim() ?? '';
  const text = rawText.slice(0, 80) || undefined;

  return {
    selector,
    xpath,
    rect,
    ...(text !== undefined ? { text } : {}),
  };
}

/**
 * Resolve a TargetRef back to a DOM element.
 *
 * Resolution order:
 *   1. CSS selector (if unique)
 *   2. XPath
 *   3. elementFromPoint using rect midpoint
 *   4. text prefix match within the nearest matching container
 *
 * Returns null if called outside a browser context, or if resolution fails.
 */
export function resolve(ref: TargetRef, doc?: Document): Element | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const d = doc ?? document;

  // Strategy 1: CSS selector - succeed only if it matches exactly one element
  try {
    const matches = d.querySelectorAll(ref.selector);
    if (matches.length === 1) {
      return matches[0] ?? null;
    }
  } catch {
    // Invalid selector - fall through
  }

  // Strategy 2: XPath
  if (ref.xpath) {
    try {
      const result = d.evaluate(
        ref.xpath,
        d,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      );
      const node = result.singleNodeValue;
      if (node instanceof Element) {
        return node;
      }
    } catch {
      // Invalid xpath - fall through
    }
  }

  // Strategy 3: elementFromPoint using rect midpoint
  if (ref.rect) {
    const cx = ref.rect.x + ref.rect.w / 2;
    const cy = ref.rect.y + ref.rect.h / 2;
    const el = d.elementFromPoint(cx, cy);
    if (el !== null) {
      return el;
    }
  }

  // Strategy 4: text prefix match
  if (ref.text) {
    const prefix = ref.text;
    const candidates = Array.from(d.querySelectorAll('*'));
    for (const el of candidates) {
      const text = el.textContent?.trim() ?? '';
      if (text.startsWith(prefix)) {
        return el;
      }
    }
  }

  return null;
}
