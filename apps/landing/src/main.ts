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
