/**
 * popup/index.ts - tiny UI for picking the active PolyChrome room.
 *
 * Three commands: Start new room, Join by code, Leave. The SW owns the
 * stored state; we just sendMessage and re-render with the response.
 */

import './style.css';
import type { RuntimeMessage, RuntimeStateResponse } from '../../background/shared.js';

function send(msg: RuntimeMessage): Promise<RuntimeStateResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: RuntimeStateResponse) => resolve(response));
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

function render(state: RuntimeStateResponse): void {
  const root = document.getElementById('root')!;
  const inRoom = state.room !== null;
  root.innerHTML = `
    <div class="card">
      <div class="who">
        <span class="dot" style="background:${escapeHtml(state.identity.color)}"></span>
        <div>
          <div class="muted">You are</div>
          <div class="name">${escapeHtml(state.identity.name)}</div>
        </div>
        <button class="link" id="open-panel" title="Open side panel">↗</button>
      </div>
      ${inRoom ? `
        <div class="room-row">
          <div class="muted">Active room</div>
          <code class="room">${escapeHtml(state.room ?? '')}</code>
        </div>
        <div class="actions">
          <button class="btn primary" id="copy">Copy invite</button>
          <button class="btn" id="leave">Leave</button>
        </div>
      ` : `
        <div class="muted center">Not in a room.</div>
        <div class="actions stack">
          <button class="btn primary" id="newroom">Start new room</button>
          <div class="join-row">
            <input id="joinid" placeholder="join code" maxlength="16" autocomplete="off" />
            <button class="btn" id="join">Join</button>
          </div>
        </div>
      `}
    </div>
  `;

  document.getElementById('open-panel')?.addEventListener('click', async () => {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.windowId !== undefined) {
      try { await chrome.sidePanel.open({ windowId: tab.windowId }); window.close(); }
      catch { /* user gesture lost; ignore */ }
    }
  });

  if (inRoom) {
    document.getElementById('copy')!.addEventListener('click', () => {
      void navigator.clipboard.writeText(state.room ?? '');
      const btn = document.getElementById('copy') as HTMLButtonElement | null;
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy invite'; }, 1200); }
    });
    document.getElementById('leave')!.addEventListener('click', async () => {
      render(await send({ type: 'setRoom', room: null }));
    });
  } else {
    document.getElementById('newroom')!.addEventListener('click', async () => {
      render(await send({ type: 'generateRoom' }));
    });
    const input = document.getElementById('joinid') as HTMLInputElement;
    const join = async (): Promise<void> => {
      const v = input.value.trim().toLowerCase();
      if (!v) return;
      render(await send({ type: 'setRoom', room: v }));
    };
    document.getElementById('join')!.addEventListener('click', () => { void join(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void join();
    });
    input.focus();
  }
}

void send({ type: 'getState' }).then(render);
