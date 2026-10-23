# Concatflow SDK

Embed a Concatflow data assistant in your product. Your customers ask questions about
**their own** data, in your app.

| Package | Where | What |
| ------- | ----- | ---- |
| [`@concatflow/node`](packages/node) | your server | opens a session for the logged-in customer; reads and erases their conversations |
| [`@concatflow/embed`](packages/embed) | the browser | loads the hosted widget; `@concatflow/embed/react` for React |

## How it fits together

1. Your backend knows who is logged in. It opens a session with your **secret** key:

   ```ts
   import { Concatflow } from "@concatflow/node";

   const concatflow = new Concatflow({ apiKey: process.env.CONCATFLOW_API_KEY! });
   const { token } = await concatflow.sessions.create({
     assistantId: "YOUR_ASSISTANT_ID",
     partitions: { customer_id: req.user.customerId }, // from YOUR session, never the request
   });
   ```

2. Your page initialises the widget with that opaque token:

   ```tsx
   import { ConcatflowAssistant } from "@concatflow/embed/react";

   <ConcatflowAssistant session={token} launcher="bubble" onSessionExpired={renew} />;
   ```

The browser never sees who the customer is — only a short-lived token that describes nothing.
You are the identity provider: Concatflow trusts the partition your server sends with your key,
and that key is what commits you.

There is also a public door (`siteToken`) for assistants that answer on public data without
any customer identity.

## Security

This repository is public on purpose. Nothing in it is secret, and security never relies on
nobody reading it: the API key stays on your server, partitions are only accepted from it, and
tokens are opaque and short-lived.

## Development

```sh
bun install        # or npm install
bun run test       # vitest
bun run typecheck
bun run build      # ESM + .d.ts into packages/*/dist
```

## License

MIT
