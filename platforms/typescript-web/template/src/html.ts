// HTML rendering with escaping by default (TS-07). Interpolated values are escaped unless
// they were produced by `html` itself (or explicitly by `raw`, which needs a reason).

export interface SafeHtml { readonly __html: string }

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

const isSafe = (v: unknown): v is SafeHtml => typeof v === 'object' && v !== null && '__html' in v;

function render(value: unknown): string {
  if (Array.isArray(value)) return value.map(render).join('');
  if (isSafe(value)) return value.__html;
  if (value === false || value === null || value === undefined) return '';
  return escape(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0]!;
  values.forEach((v, i) => { out += render(v) + strings[i + 1]!; });
  return { __html: out };
}

/** Trusted markup that must not be escaped. Use sparingly, and never for user input. */
export function raw(markup: string): SafeHtml {
  return { __html: markup };
}

export interface PageUser { name: string; roles: string[] }

export function page(options: { title: string; user?: PageUser | undefined; csrf?: string | undefined; banner?: SafeHtml | string | undefined; body: SafeHtml }): string {
  const { title, user, csrf, banner, body } = options;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
<header>
  <a class="brand" href="/">${title}</a>
  ${user ? html`<form method="post" action="/sign-out" class="signout">
    <span>${user.name} (${user.roles.join(', ') || 'no role'})</span>
    <input type="hidden" name="csrf" value="${csrf}">
    <button>Sign out</button>
  </form>` : ''}
</header>
${banner ? html`<p class="banner" role="status">${banner}</p>` : ''}
<main>
${body}
</main>
</body>
</html>`.__html;
}
