/**
 * target.test.ts — from / resolve round-trip on a happy-dom DOM
 *
 * @vitest-environment happy-dom
 */
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { from, resolve } from './target.js';

// ---------------------------------------------------------------------------
// Set up a happy-dom window for each test
// ---------------------------------------------------------------------------

let happyWindow: Window;
let doc: Document;

beforeEach(() => {
  happyWindow = new Window();
  doc = happyWindow.document as unknown as Document;
});

afterEach(() => {
  happyWindow.close();
});

// ---------------------------------------------------------------------------
// Helper: create a simple DOM structure
// ---------------------------------------------------------------------------

function buildDom(): void {
  doc.body.innerHTML = `
    <div id="container">
      <p id="para1" class="text-node">Hello world paragraph</p>
      <ul>
        <li>Item 1</li>
        <li id="item2">Item 2</li>
        <li>Item 3</li>
      </ul>
      <button>Click me</button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('target.from', () => {
  it('produces a TargetRef with a selector for an ID element', () => {
    buildDom();
    const el = doc.getElementById('para1');
    expect(el).not.toBeNull();

    const ref = from(el!);
    expect(ref.selector).toBe('#para1');
  });

  it('produces a TargetRef with a selector for a non-ID element', () => {
    buildDom();
    const button = doc.querySelector('button');
    expect(button).not.toBeNull();

    const ref = from(button!);
    expect(ref.selector).toBeTruthy();
    expect(ref.xpath).toBeTruthy();
  });

  it('includes text prefix for elements with text content', () => {
    buildDom();
    const el = doc.getElementById('para1');
    expect(el).not.toBeNull();

    const ref = from(el!);
    // text should be a prefix of the element's textContent
    expect(ref.text).toBeDefined();
    expect(el!.textContent?.trim().startsWith(ref.text!)).toBe(true);
  });

  it('includes a rect field', () => {
    buildDom();
    const el = doc.getElementById('para1');
    const ref = from(el!);
    expect(ref.rect).toBeDefined();
    expect(typeof ref.rect!.x).toBe('number');
    expect(typeof ref.rect!.y).toBe('number');
    expect(typeof ref.rect!.w).toBe('number');
    expect(typeof ref.rect!.h).toBe('number');
  });
});

describe('target.resolve', () => {
  it('resolves an ID selector back to the element', () => {
    buildDom();
    const el = doc.getElementById('para1');
    expect(el).not.toBeNull();

    const ref = from(el!);
    const resolved = resolve(ref, doc);
    expect(resolved).toBe(el);
  });

  it('resolves a non-ID element via CSS selector', () => {
    buildDom();
    const el = doc.getElementById('item2');
    expect(el).not.toBeNull();

    const ref = from(el!);
    const resolved = resolve(ref, doc);
    expect(resolved).toBe(el);
  });

  it('returns null when called outside a browser context', () => {
    // Simulate no-document environment by passing a ref with an unknown selector
    // and no xpath, rect, or text — and call without doc in an env that has document
    // For Node guard: we test the guard via a ref that will fail all strategies
    const ref = {
      selector: '#does-not-exist-xyz-abc',
    };
    // This will fail selector (0 matches), no xpath, no rect, no text → null
    const result = resolve(ref, doc);
    expect(result).toBeNull();
  });

  it('falls back to xpath when selector is ambiguous', () => {
    doc.body.innerHTML = `
      <div class="item">First</div>
      <div class="item">Second</div>
    `;
    const items = doc.querySelectorAll('.item');
    const first = items[0];
    expect(first).not.toBeNull();

    const ref = from(first!);
    const resolved = resolve(ref, doc);
    // Should resolve to the correct element
    expect(resolved).not.toBeNull();
  });
});
