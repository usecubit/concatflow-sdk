# @concatflow/embed

Browser loader for Concatflow's embedded assistant, with a React component.

```sh
npm install @concatflow/embed
```

Like `@stripe/stripe-js`, this package does **not** bundle the widget. It injects the hosted
`widget.js` once and gives you a typed API on top. The widget itself — launcher, iframe,
conversation — always comes from Concatflow, so it is never frozen in your bundle at an old
version.

## Two doors

- **Per user** — `session`: a token your server opened for the logged-in customer with
  [`@concatflow/node`](../node). The assistant only sees that customer's data.
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
