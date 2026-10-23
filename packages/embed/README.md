# @concatflow/embed

Browser loader for Concatflow's embedded assistant, with a React component.

```sh
npm install @concatflow/embed
```

Like `@stripe/stripe-js`, this package does **not** bundle the widget. It injects the hosted
`widget.js` once and gives you a typed API on top. The widget itself — launcher, iframe,
conversation — always comes from Concatflow, so it is never frozen in your bundle at an old
version.

## No build step: paste two tags

You don't need this package to put the assistant on a page. For the **public door**, paste
the snippet from your dashboard as is:

```html
<script src="https://dash.usecubit.io/widget.js"></script>
<concatflow-assistant site-token="st_…" launcher="bar"></concatflow-assistant>
```

`launcher="bar"` puts a search bar where the element is written; without it, a chat bubble
floats over the page. `theme` (`auto` | `light` | `dark`), `accent` and `placeholder` are
optional attributes.

For the **per-user door**, your page needs a token from your server, so a few lines of
JavaScript:

```html
<script src="https://dash.usecubit.io/widget.js"></script>
<div id="assistant"></div>
<script>
  Concatflow.init({
    session: "{{ token opened by your server }}",
    launcher: "bar",
    target: "#assistant",
    onSessionExpired: () =>
      fetch("/api/concatflow/session", { method: "POST" })
        .then((r) => r.json())
        .then((s) => s.token),
  });
</script>
```

Use the npm package when you want types, a React component, or to load the script only when
needed.

## Where to find your identifiers

All in the Concatflow dashboard:

| What | Where | Used by |
| ---- | ----- | ------- |
| Site token `st_…` | the assistant's public door: turn it on in the **Doors** tab; the snippet to paste contains it | the browser (public, safe to expose) |
| Assistant ID | the assistant's **Integration** tab (also in its URL, `/assistants/<id>`) | your server |
| API key `lyra_sk_…` | **Settings → Developers → API keys** (workspace owner only) | your server only — never the browser |

## Two doors

- **Per user** — `session`: a token your server opened for the logged-in customer with
  [`@concatflow/node`](https://www.npmjs.com/package/@concatflow/node). The assistant only sees
  that customer's data.
- **Public** — `siteToken`: the assistant's public token, no customer identity, only data
  marked public.

Pass exactly one of them.

## React

```tsx
"use client";
import { ConcatflowAssistant } from "@concatflow/embed/react";

export function Assistant({ initialToken }: { initialToken: string }) {
  return (
    <ConcatflowAssistant
      session={initialToken}
      launcher="bubble"
      onSessionExpired={async () => {
        const res = await fetch("/api/concatflow/session", { method: "POST" });
        return (await res.json()).token;
      }}
    />
  );
}
```

- `launcher="bubble"` (default) floats over the page; the component renders nothing.
- `launcher="bar"` renders the bar inline, inside a `<div>` the component owns (style it with
  `className` / `style`).
- Changing the `session` prop hands the new token to the running widget. Unmounting destroys
  it. When the logged-in customer changes, open a new session and pass it.
- `theme`, `accent` and `placeholder` are passed through as in vanilla; changing one re-creates the
  widget.
- `onError` receives load or option errors (defaults to `console.error`).

Public door:

```tsx
<ConcatflowAssistant siteToken="YOUR_SITE_TOKEN" launcher="bar" className="h-14" />
```

## Vanilla

```ts
import { loadConcatflow } from "@concatflow/embed";

const Concatflow = await loadConcatflow(); // injects widget.js once; later calls share the promise
const assistant = Concatflow.init({
  session: tokenFromYourServer,
  launcher: "bar",
  target: "#assistant", // element or selector, for the bar; without it, a ⌘K / Ctrl+K overlay
  theme: "auto", // "auto" | "light" | "dark"
  accent: "#0E7C66", // the bar's magnifier and focus ring
  placeholder: "Ask about your accounts…", // the bar's text before the assistant loads
  onSessionExpired: () => fetch("/api/concatflow/session", { method: "POST" })
    .then((r) => r.json())
    .then((s) => s.token),
});

assistant.open();
assistant.close();
assistant.setSession(newToken);
assistant.destroy();
```

`init` validates its options and throws a `TypeError` on the first problem.

`loadConcatflow({ base })` loads from another Concatflow origin (default
`https://dash.usecubit.io`); `init` uses the same origin unless you pass `base` there too.

Server-side rendering: import freely, but call `loadConcatflow()` only in the browser (it
rejects on the server). The React component already does this in an effect.

## Versioning

The package and the hosted script are versioned independently. Every `init` call carries the
options-contract version (`v: 1`, exported as `PROTOCOL_VERSION`), and the messages between the
hosted script and its iframe carry theirs. The hosted script keeps understanding older
versions, so an old copy of this package in your bundle keeps working after Concatflow ships
a new widget.

## Content Security Policy

Allow the Concatflow origin in `script-src` and `frame-src`.
