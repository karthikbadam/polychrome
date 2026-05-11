// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createPolyApi } from './api.js';
import { installOpsPanel, summarize } from './ops-panel.js';

afterEach(() => {
  document.body.replaceChildren();
  document.getElementById('pc-ops-panel-styles')?.remove();
});

function setup(): { doc: Y.Doc; api: ReturnType<typeof createPolyApi> } {
  const doc = new Y.Doc();
  const api = createPolyApi(doc, { actorId: 'A', name: 'alice', color: '#7c5cff' });
  return { doc, api };
}

describe('installOpsPanel', () => {
  it('mounts a collapsed panel with a toggle and a count', () => {
    const { api } = setup();
    const h = installOpsPanel(api);
    const panel = document.getElementById('pc-ops-panel')!;
    const body = panel.querySelector('.pc-ops-body') as HTMLElement;
    const count = panel.querySelector('.pc-ops-count')!;
    expect(body.style.display).toBe('none');
    expect(count.textContent).toBe('0');
    expect(h.isOpen).toBe(false);
    h.destroy();
  });

  it('toggle button opens and closes the panel', () => {
    const { api } = setup();
    const h = installOpsPanel(api);
    const toggle = document.querySelector('.pc-ops-toggle') as HTMLButtonElement;
    toggle.click();
    expect(h.isOpen).toBe(true);
    toggle.click();
    expect(h.isOpen).toBe(false);
    h.destroy();
  });

  it('renders a row per record, newest first', () => {
    const { api } = setup();
    api.share<number>('n').set(1);
    api.share<number>('n').set(2);
    api.checkpoint('hello');
    const h = installOpsPanel(api);
    h.setOpen(true);
    const rows = document.querySelectorAll('.pc-ops-item');
    expect(rows).toHaveLength(3);
    // Most recent (the checkpoint) is first.
    expect(rows[0]!.querySelector('.pc-ops-kind')!.textContent).toBe('checkpoint');
    expect(rows[2]!.querySelector('.pc-ops-kind')!.textContent).toBe('state_set');
    h.destroy();
  });

  it('clicking a row expands its JSON details', () => {
    const { api } = setup();
    api.share<{ x: number }>('pos').set({ x: 7 });
    const h = installOpsPanel(api);
    h.setOpen(true);

    const row = document.querySelector('.pc-ops-item') as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('.pc-ops-details')).toBeNull();

    row.click();
    const expanded = document.querySelector('.pc-ops-item') as HTMLElement;
    expect(expanded.getAttribute('aria-expanded')).toBe('true');
    const details = expanded.querySelector('.pc-ops-details') as HTMLElement;
    expect(details).not.toBeNull();
    expect(details.textContent).toContain('"key": "pos"');
    expect(details.textContent).toContain('"x": 7');

    // Clicking again collapses.
    expanded.click();
    expect((document.querySelector('.pc-ops-item') as HTMLElement).getAttribute('aria-expanded')).toBe('false');
    h.destroy();
  });

  it('auto-updates the count and rows when new ops arrive', () => {
    const { api } = setup();
    const h = installOpsPanel(api);
    const count = document.querySelector('.pc-ops-count')!;
    expect(count.textContent).toBe('0');
    api.share<number>('n').set(1);
    expect(count.textContent).toBe('1');
    api.list<string>('s').insert(0, 'a');
    expect(count.textContent).toBe('2');
    h.destroy();
  });

  it('destroy() removes the panel and unsubscribes', () => {
    const { api } = setup();
    const h = installOpsPanel(api);
    expect(document.getElementById('pc-ops-panel')).not.toBeNull();
    h.destroy();
    expect(document.getElementById('pc-ops-panel')).toBeNull();
    // No throw on subsequent api activity.
    api.share<number>('n').set(1);
  });

  it('injects styles only once even with multiple panels', () => {
    const { api } = setup();
    const h1 = installOpsPanel(api);
    const h2 = installOpsPanel(api);
    expect(document.querySelectorAll('#pc-ops-panel-styles')).toHaveLength(1);
    h1.destroy();
    h2.destroy();
  });
});

describe('summarize', () => {
  it('handles each op kind', () => {
    expect(summarize({
      kind: 'state_set', at: 0, by: 'A', byName: 'a', byColor: '#fff',
      key: 'k', value: 1, prevValue: undefined, hadPrev: false,
    })).toBe('k = 1');
    expect(summarize({
      kind: 'list_insert', at: 0, by: 'A', byName: 'a', byColor: '#fff',
      listId: 'l', index: 2, value: 'v',
    })).toBe('l[2] += "v"');
    expect(summarize({
      kind: 'list_delete', at: 0, by: 'A', byName: 'a', byColor: '#fff',
      listId: 'l', index: 0, prevValue: 'v',
    })).toBe('l[0] removed');
    expect(summarize({
      kind: 'checkpoint', at: 0, by: 'A', byName: 'a', byColor: '#fff',
      label: 'note',
    })).toBe('note');
  });
});
