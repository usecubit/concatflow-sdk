# @concatflow/node

Server-side SDK for Concatflow's embedded assistant. Your backend opens a session for the
end customer who is logged in to **your** product, and hands the opaque token to the browser.

- Zero runtime dependencies, native `fetch`, Node ≥ 18.
- Refuses to run in a browser: your secret key would leak to every visitor.

```sh
npm install @concatflow/node
```

## Where to find your identifiers

In the Concatflow dashboard:

- **API key** `lyra_sk_…`: **Settings → Developers → API keys**. Only the workspace owner can
  create one. Keep it in an environment variable on your server; it never goes to the browser.
- **Assistant ID**: the assistant's **Integration** tab (also in its URL, `/assistants/<id>`).
- **Partition dimensions**: the assistant's **Isolation** tab lists the keys `partitions` must
  carry (for example `customer_id`).

The browser side, which shows the assistant with the token you open here, is
[`@concatflow/embed`](https://www.npmjs.com/package/@concatflow/embed).

## Why the server opens the session

Only your server knows who is logged in. The partition (`{ customer_id: "4712" }`) is sent
from your server with your secret key; the browser only ever sees an opaque, short-lived token
that describes nothing. Tampering with it can only break the tamperer's own session.

**Always take the partition from your own session, never from the incoming request.**
`req.body.customerId` is whatever the visitor typed in their console.

## Open a session

```ts
import { Concatflow } from "@concatflow/node";

const concatflow = new Concatflow({ apiKey: process.env.CONCATFLOW_API_KEY! }); // lyra_sk_…

const { token, expiresAt } = await concatflow.sessions.create({
  assistantId: "YOUR_ASSISTANT_ID",
  partitions: { customer_id: currentUser.customerId }, // strings or numbers
});
```

The keys of `partitions` must be exactly the partition dimensions signed on the assistant
(otherwise `403 partition_keys_mismatch`). Tokens are short-lived (about 15 minutes); the
conversation itself is tied to the partition and survives them, so the customer finds it again
tomorrow.

### Express

```ts
import express from "express";
import { Concatflow, ConcatflowError } from "@concatflow/node";

const app = express();
const concatflow = new Concatflow({ apiKey: process.env.CONCATFLOW_API_KEY! });

// requireLogin is your own auth middleware; req.user comes from YOUR session.
app.post("/concatflow/session", requireLogin, async (req, res) => {
  try {
    const session = await concatflow.sessions.create({
      assistantId: process.env.CONCATFLOW_ASSISTANT_ID!,
      partitions: { customer_id: req.user.customerId },
    });
    res.json(session); // { token, expiresAt }
  } catch (err) {
    if (err instanceof ConcatflowError) {
      res.status(502).json({ error: err.code ?? "concatflow_error" });
    } else throw err;
  }
});
```

### Next.js (App Router)

```ts
// lib/concatflow.ts — server only
import "server-only";
import { Concatflow } from "@concatflow/node";

export const concatflow = new Concatflow({ apiKey: process.env.CONCATFLOW_API_KEY! });

export async function openSession(customerId: string) {
  return concatflow.sessions.create({
    assistantId: process.env.CONCATFLOW_ASSISTANT_ID!,
    partitions: { customer_id: customerId },
  });
}
```

```ts
// app/api/concatflow/session/route.ts — lets the widget renew an expired token
import { auth } from "@/lib/auth"; // your auth
import { openSession } from "@/lib/concatflow";

export async function POST() {
  const user = await auth();
  if (!user) return new Response(null, { status: 401 });
  return Response.json(await openSession(user.customerId));
}
```

```tsx
// app/dashboard/page.tsx — server component
import { auth } from "@/lib/auth";
import { openSession } from "@/lib/concatflow";
import { Assistant } from "./assistant"; // client component, see @concatflow/embed

export default async function Page() {
  const user = await auth();
  const { token } = await openSession(user!.customerId);
  return <Assistant initialToken={token} />;
}
```

## Read a customer's conversation

```ts
const thread = await concatflow.conversations.list({
  assistantId: "YOUR_ASSISTANT_ID",
  partition: { customer_id: "4712" },
});
// { partition, since, launcher, questions, credits_cents, messages: [{ id, role, text, at, credits_cents, blocks }] }
```

## Erase a customer's conversation (GDPR)

Call it when your user deletes their account. You are the data controller; this lets you erase
without contacting us.

```ts
await concatflow.conversations.erase({
  assistantId: "YOUR_ASSISTANT_ID",
  partition: { customer_id: "4712" },
});
```

The partition is sent as `customer_id=4712` (several keys joined with `,`). Keys and values
containing `,` or `=` are refused, since they would make the partition ambiguous.

## Errors

Every non-2xx answer throws a `ConcatflowError` with `status`, `code` (when the API gives one)
and the parsed `body`. The API key never appears in error messages.

| status | typical `code`            | meaning                                                      |
| ------ | ------------------------- | ------------------------------------------------------------ |
| 400    | `invalid_body`            | malformed request (e.g. `assistantId` is not a UUID)         |
| 401    | `invalid_api_key`         | the key is wrong or revoked                                  |
| 402    |                           | not enough credits                                           |
| 403    | `partition_keys_mismatch` | partition keys are not exactly the assistant's dimensions    |
| 404    |                           | unknown assistant, or one from another workspace             |
| 409    | `door_closed`, `not_published`, `isolation_unsigned` | the per-user door is closed, the assistant unpublished, or its isolation unsigned |
| 502    | `backend_unreachable`     | Concatflow could not reach its API; retry                    |

Validation errors (empty partitions, bad key prefix, running in a browser) throw before any
request is made.

## Options

```ts
new Concatflow({
  apiKey: "lyra_sk_…", // required
  baseUrl: "https://dash.usecubit.io", // default
});
```
