// Landing is mostly static. This file exists so the page has a module entry
// for Vite to bundle CSS and to provide a hook for future enhancements
// (theme toggles, copyable room codes from query params, etc.).

const dl = document.querySelector<HTMLAnchorElement>('a.dl');
if (dl) {
  fetch(dl.href, { method: 'HEAD' })
    .then((r) => {
      if (!r.ok) {
        dl.classList.add('disabled');
        dl.textContent = 'extension.zip (build pending)';
        dl.removeAttribute('href');
      }
    })
    .catch(() => {
      // offline / dev - leave the link alone
    });
}

/**
 * Dev-mode card href rewrite.
 *
 * In production (gh-pages / `pnpm preview`) the landing and the four
 * demos are served from one origin; the cards' relative `./examples/X/`
 * hrefs resolve correctly. In `pnpm run dev` (turbo) every demo runs
 * on its own Vite port, so the same relative href falls back to the
 * landing's index.html and the URL compounds on each click
 * ('examples/planets/examples/planets/...').
 *
 * We pin each demo to a known dev port (see each demo's vite.config.ts)
 * and rewrite the cards here when we detect the landing dev origin.
 */
const DEMO_DEV_PORTS: Record<string, number> = {
  drawing: 5181,
  scatterplot: 5182,
  choropleth: 5183,
  planets: 5184,
};
if (
  import.meta.env.DEV &&
  typeof location !== 'undefined' &&
  location.hostname === 'localhost' &&
  location.port === '5180'
) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a.card[href^="./examples/"]')) {
    const m = /^\.\/examples\/([^/]+)\/?$/.exec(a.getAttribute('href') ?? '');
    const port = m ? DEMO_DEV_PORTS[m[1] ?? ''] : undefined;
    if (port) a.href = `http://localhost:${port}/`;
  }
}
