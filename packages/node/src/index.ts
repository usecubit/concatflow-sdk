/** The Concatflow API origin. Override with `baseUrl` (e.g. for a self-hosted instance). */
export const DEFAULT_BASE_URL = "https://dash.usecubit.io";

const KEY_PREFIX = "lyra_sk_";

export interface ConcatflowConfig {
  /** Your secret API key (`lyra_sk_…`). Server-side only. */
  apiKey: string;
  baseUrl?: string;
}

/**
 * Who the end customer is, as your own server knows it: `{ customer_id: "4712" }`.
 * Keys must be exactly the partition dimensions signed on the assistant.
 */
export type Partitions = Record<string, string | number>;

export interface Session {
  /** Opaque, short-lived token to hand to the browser widget. */
  token: string;
  /** ISO 8601 timestamp. Open a new session when it expires. */
  expiresAt: string;
}

export interface ThreadBlock {
  id: string;
  kind: string;
  title: string;
  spec: Record<string, unknown>;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** ISO 8601 timestamp. */
  at: string;
  /** Cost in credit cents; only set on assistant answers. */
  credits_cents: number | null;
  blocks: ThreadBlock[];
}

export interface Thread {
  partition: Record<string, string>;
  /** ISO 8601 timestamp of the first message, or null when empty. */
  since: string | null;
  launcher: "bubble" | "bar" | null;
  questions: number;
  credits_cents: number;
  messages: ThreadMessage[];
}

export interface ConversationParams {
  assistantId: string;
  partition: Partitions;
}

/**
 * A non-2xx answer from the Concatflow API. `code` is the machine-readable reason when the
 * API gives one (`invalid_api_key`, `partition_keys_mismatch`, …).
 */
export class ConcatflowError extends Error {
  override name = "ConcatflowError";
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** Validates and stringifies partitions. Every value must be a non-empty string or a finite number. */
function normalizePartitions(partitions: Partitions, field: string): Record<string, string> {
  if (partitions === null || typeof partitions !== "object" || Array.isArray(partitions)) {
    throw new TypeError(`Concatflow: \`${field}\` must be an object like { customer_id: "4712" }.`);
  }
  const entries = Object.entries(partitions);
  if (entries.length === 0) {
    throw new TypeError(`Concatflow: \`${field}\` must name at least one partition key.`);
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      throw new TypeError(`Concatflow: \`${field}.${key}\` must be a finite number or a string.`);
    }
    if (typeof raw !== "string" && typeof raw !== "number") {
      throw new TypeError(`Concatflow: \`${field}.${key}\` must be a string or a number.`);
    }
    const value = String(raw);
    if (key === "" || value === "") {
      throw new TypeError(`Concatflow: \`${field}\` keys and values must not be empty.`);
    }
    out[key] = value;
  }
  return out;
}

/**
 * `{customer_id: "4712", region: "eu"}` → `customer_id=4712,region=eu`. Refuses `,` and `=` in
 * keys or values: they would make the encoding ambiguous and could address another customer.
 */
export function encodePartition(partition: Partitions): string {
  const normalized = normalizePartitions(partition, "partition");
  return Object.entries(normalized)
    .map(([key, value]) => {
      if (/[,=]/.test(key) || /[,=]/.test(value)) {
        throw new TypeError("Concatflow: partition keys and values must not contain `,` or `=`.");
      }
      return `${key}=${value}`;
    })
    .join(",");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`Concatflow: \`${field}\` must be a non-empty string.`);
  }
  return value;
}

export class Concatflow {
  readonly #apiKey: string;
  readonly #baseUrl: string;

  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL }: ConcatflowConfig) {
    if ((globalThis as { window?: unknown }).window !== undefined) {
      throw new Error(
        "Concatflow: @concatflow/node must not run in a browser — your secret API key would be exposed to every visitor. " +
          "Open sessions on your server and use @concatflow/embed in the browser.",
      );
    }
    if (typeof apiKey !== "string" || !apiKey.startsWith(KEY_PREFIX)) {
      throw new Error(`Concatflow: \`apiKey\` must be a secret key starting with "${KEY_PREFIX}".`);
    }
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  readonly sessions = {
    /** Opens a widget session for one end customer. Call it from your server, per page load. */
    create: async ({ assistantId, partitions }: { assistantId: string; partitions: Partitions }): Promise<Session> => {
      const body = {
        assistant_id: requireString(assistantId, "assistantId"),
        partitions: normalizePartitions(partitions, "partitions"),
      };
      const res = (await this.#request("POST", "/api/v1/embed/sessions", body)) as {
        token: string;
        expires_at: string;
      };
      return { token: res.token, expiresAt: res.expires_at };
    },
  };

  readonly conversations = {
    /** The end customer's conversation with the assistant. */
    list: async (params: ConversationParams): Promise<Thread> =>
      (await this.#request("GET", this.#conversationsPath(params))) as Thread,
    /** Erases the end customer's conversation (e.g. when they delete their account). */
    erase: async (params: ConversationParams): Promise<void> => {
      await this.#request("DELETE", this.#conversationsPath(params));
    },
  };

  #conversationsPath({ assistantId, partition }: ConversationParams): string {
    const id = encodeURIComponent(requireString(assistantId, "assistantId"));
    return `/api/v1/assistants/${id}/conversations?partition=${encodeURIComponent(encodePartition(partition))}`;
  }

  async #request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#apiKey}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(this.#baseUrl + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) throw toError(res.status, parsed);
    return parsed;
  }
}

function toError(status: number, body: unknown): ConcatflowError {
  const obj = (body && typeof body === "object" ? body : {}) as { code?: unknown; detail?: unknown };
  const detail = (obj.detail && typeof obj.detail === "object" ? obj.detail : {}) as { code?: unknown };
  const code = typeof obj.code === "string" ? obj.code : typeof detail.code === "string" ? detail.code : undefined;
  const reason = typeof obj.detail === "string" ? obj.detail : code ?? "request failed";
  return new ConcatflowError(`Concatflow API ${status}: ${reason}`, status, code, body);
}
