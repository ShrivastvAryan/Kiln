const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Small branded status pages served when a deployment can't be shown. */
export function statusPage(opts: { title: string; message: string; code: string; refresh?: boolean; dashboard: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${opts.refresh ? '<meta http-equiv="refresh" content="3" />' : ''}
<title>${esc(opts.title)} · Kiln</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #431407 0%, #0c0a09 60%); color: #f5f5f4; }
  .card { max-width: 440px; width: 100%; text-align: center; padding: 40px 28px; border-radius: 16px;
    border: 1px solid #292524; background: rgba(28,25,23,.7); backdrop-filter: blur(8px); }
  .code { font: 600 12px ui-monospace, monospace; letter-spacing: .12em; color: #fb923c; text-transform: uppercase; }
  h1 { font-size: 22px; margin: 12px 0 8px; }
  p { color: #a8a29e; line-height: 1.6; margin: 0 0 24px; font-size: 14px; }
  a { display: inline-block; padding: 9px 16px; border-radius: 8px; background: #f97316; color: #0c0a09;
    text-decoration: none; font-size: 14px; font-weight: 500; }
  .spinner { width: 28px; height: 28px; margin: 0 auto 8px; border-radius: 50%;
    border: 3px solid #44403c; border-top-color: #fb923c; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <main class="card">
    ${opts.refresh ? '<div class="spinner"></div>' : ''}
    <div class="code">${esc(opts.code)}</div>
    <h1>${esc(opts.title)}</h1>
    <p>${esc(opts.message)}</p>
    <a href="${esc(opts.dashboard)}">Open Kiln console</a>
  </main>
</body>
</html>`;
}
