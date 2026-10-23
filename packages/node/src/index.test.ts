import { afterEach, describe, expect, it, vi } from "vitest";
import { Concatflow, ConcatflowError, DEFAULT_BASE_URL, encodePartition } from "./index.js";

const KEY = "lyra_sk_test_0123456789";

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("constructor guards", () => {
  it("refuses to run where `window` exists", () => {
    vi.stubGlobal("window", {});
    expect(() => new Concatflow({ apiKey: KEY })).toThrow(/must not run in a browser/);
  });

  it("refuses a key without the secret prefix, without echoing it", () => {
    const err = (() => {
      try {
        new Concatflow({ apiKey: "pk_live_abc" });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).toMatch(/lyra_sk_/);
    expect(err?.message).not.toContain("pk_live_abc");
  });

  it("defaults to the hosted origin and strips a trailing slash from baseUrl", async () => {
    const f = mockFetch(201, { token: "t", expires_at: "x" });
    await new Concatflow({ apiKey: KEY }).sessions.create({ assistantId: "a", partitions: { c: "1" } });
    await new Concatflow({ apiKey: KEY, baseUrl: "http://localhost:3000/" }).sessions.create({
      assistantId: "a",
      partitions: { c: "1" },
    });
    expect(f.mock.calls[0]?.[0]).toBe(`${DEFAULT_BASE_URL}/api/v1/embed/sessions`);
    expect(f.mock.calls[1]?.[0]).toBe("http://localhost:3000/api/v1/embed/sessions");
  });
});

describe("sessions.create", () => {
  it("posts snake_case JSON with the bearer key and maps the answer to camelCase", async () => {
    const f = mockFetch(201, { token: "opaque", expires_at: "2026-10-23T10:15:00Z" });
    const cf = new Concatflow({ apiKey: KEY });
    const session = await cf.sessions.create({ assistantId: "asst_1", partitions: { customer_id: 4712 } });

    expect(session).toEqual({ token: "opaque", expiresAt: "2026-10-23T10:15:00Z" });
    const [, init] = f.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ assistant_id: "asst_1", partitions: { customer_id: "4712" } });
  });

  it.each([
    [{}, /at least one/],
    [{ customer_id: "" }, /not be empty/],
    [{ customer_id: Number.NaN }, /finite/],
    [{ customer_id: null }, /string or a number/],
    [["4712"], /must be an object/],
  ])("rejects partitions %j before any request", async (partitions, msg) => {
    const f = mockFetch(201, {});
    const cf = new Concatflow({ apiKey: KEY });
    await expect(cf.sessions.create({ assistantId: "a", partitions: partitions as never })).rejects.toThrow(msg);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects an empty assistantId", async () => {
    mockFetch(201, {});
    await expect(new Concatflow({ apiKey: KEY }).sessions.create({ assistantId: "", partitions: { c: "1" } })).rejects.toThrow(
      /assistantId/,
    );
  });
});

describe("partition encoding", () => {
  it("encodes one key as k=v and several joined by commas", () => {
    expect(encodePartition({ customer_id: "4712" })).toBe("customer_id=4712");
    expect(encodePartition({ customer_id: 4712, region: "eu" })).toBe("customer_id=4712,region=eu");
  });

  it("refuses separators that would let a value address another partition", () => {
    expect(() => encodePartition({ customer_id: "4712,tenant=9" })).toThrow(/must not contain/);
    expect(() => encodePartition({ "a=b": "1" })).toThrow(/must not contain/);
  });
});

describe("conversations", () => {
  const thread = {
    partition: { customer_id: "4712" },
    since: "2026-10-22T09:00:00Z",
    launcher: "bubble",
    questions: 1,
    credits_cents: 12,
    messages: [
      { id: "m1", role: "user", text: "Revenue?", at: "2026-10-22T09:00:00Z", credits_cents: null, blocks: [] },
    ],
  };

  it("list GETs the thread with the partition URL-encoded as one query param", async () => {
    const f = mockFetch(200, thread);
    const cf = new Concatflow({ apiKey: KEY });
    const got = await cf.conversations.list({ assistantId: "asst/1", partition: { customer_id: "4712", region: "eu" } });

    expect(got).toEqual(thread);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`${DEFAULT_BASE_URL}/api/v1/assistants/asst%2F1/conversations?partition=customer_id%3D4712%2Cregion%3Deu`);
    expect(new URL(url).searchParams.get("partition")).toBe("customer_id=4712,region=eu");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("erase DELETEs the same URL and resolves on 204", async () => {
    const f = mockFetch(204);
    await expect(
      new Concatflow({ apiKey: KEY }).conversations.erase({ assistantId: "asst_1", partition: { customer_id: "4712" } }),
    ).resolves.toBeUndefined();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`${DEFAULT_BASE_URL}/api/v1/assistants/asst_1/conversations?partition=customer_id%3D4712`);
    expect(init?.method).toBe("DELETE");
  });
});

describe("errors", () => {
  // The real shapes: `{error}` from the key-checking relay, `{detail: {code}}` from the API behind it.
  it.each([
    [401, { error: "invalid_api_key" }, "invalid_api_key"],
    [400, { error: "invalid_body" }, "invalid_body"],
    [502, { error: "backend_unreachable" }, "backend_unreachable"],
    [403, { detail: { code: "partition_keys_mismatch" } }, "partition_keys_mismatch"],
    [409, { detail: { code: "door_closed" } }, "door_closed"],
    [402, { detail: { code: "insufficient_credits" } }, "insufficient_credits"],
    [404, { detail: "Not Found" }, undefined],
    [500, "upstream exploded", undefined],
  ])("maps %i to a ConcatflowError with status and code", async (status, body, code) => {
    mockFetch(status, body);
    const err = await new Concatflow({ apiKey: KEY }).sessions
      .create({ assistantId: "a", partitions: { c: "1" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConcatflowError);
    expect(err).toMatchObject({ status, code, body });
    expect((err as Error).message).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });
});
