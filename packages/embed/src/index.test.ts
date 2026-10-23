// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConcatflowGlobal, ConcatflowOptions } from "./index.js";

type Mod = typeof import("./index.js");
let mod: Mod;

function fakeGlobal() {
  const instance = { setSession: vi.fn(), open: vi.fn(), close: vi.fn(), destroy: vi.fn() };
  const init = vi.fn((_o: unknown) => instance);
  return { global: { init } as unknown as ConcatflowGlobal, init, instance };
}

/** What the hosted widget.js does when it finishes loading. */
function finishLoading(src: string, g: ConcatflowGlobal) {
  const script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)!;
  window.Concatflow = g;
  script.dispatchEvent(new Event("load"));
}

beforeEach(async () => {
  vi.resetModules();
  mod = await import("./index.js");
});

afterEach(() => {
  document.head.innerHTML = "";
  delete window.Concatflow;
});

describe("loadConcatflow", () => {
  it("injects widget.js once and shares one promise across calls", async () => {
    const p1 = mod.loadConcatflow();
    const p2 = mod.loadConcatflow();
    expect(p1).toBe(p2);
    const scripts = document.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe(`${mod.DEFAULT_BASE}/widget.js`);
    expect(scripts[0]?.async).toBe(true);

    finishLoading(`${mod.DEFAULT_BASE}/widget.js`, fakeGlobal().global);
    await expect(p1).resolves.toHaveProperty("init");
    expect(document.querySelectorAll("script")).toHaveLength(1);
  });

  it("reuses a <script> tag the page already has", async () => {
    const tag = document.createElement("script");
    tag.src = "https://example.test/widget.js";
    document.head.appendChild(tag);

    const p = mod.loadConcatflow({ base: "https://example.test/" });
    expect(document.querySelectorAll("script")).toHaveLength(1);
    finishLoading("https://example.test/widget.js", fakeGlobal().global);
    await expect(p).resolves.toHaveProperty("init");
  });

  it("resolves without injecting when window.Concatflow is already there", async () => {
    window.Concatflow = fakeGlobal().global;
    await expect(mod.loadConcatflow()).resolves.toHaveProperty("init");
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });

  it("rejects a second base once loading from another origin", async () => {
    void mod.loadConcatflow();
    await expect(mod.loadConcatflow({ base: "https://other.test" })).rejects.toThrow(/already loaded/);
  });

  it("rejects on script error and lets a later call retry", async () => {
    const p = mod.loadConcatflow();
    document.querySelector("script")!.dispatchEvent(new Event("error"));
    await expect(p).rejects.toThrow(/failed to load/);

    document.head.innerHTML = "";
    const retry = mod.loadConcatflow();
    expect(retry).not.toBe(p);
    finishLoading(`${mod.DEFAULT_BASE}/widget.js`, fakeGlobal().global);
    await expect(retry).resolves.toHaveProperty("init");
  });

  it("rejects when the script loads but defines nothing", async () => {
    const p = mod.loadConcatflow();
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    await expect(p).rejects.toThrow(/did not define window.Concatflow/);
  });
});

describe("init", () => {
  it("forwards options with the load base and protocol version", async () => {
    const fake = fakeGlobal();
    window.Concatflow = fake.global;
    const cf = await mod.loadConcatflow({ base: "https://example.test" });
    const handle = cf.init({
      session: "tok",
      launcher: "bar",
      target: "#slot",
      theme: "dark",
      accent: "#0E7C66",
      placeholder: "Ask about your accounts…",
    });

    expect(handle).toBe(fake.instance);
    expect(fake.init).toHaveBeenCalledWith({
      base: "https://example.test",
      session: "tok",
      launcher: "bar",
      target: "#slot",
      theme: "dark",
      accent: "#0E7C66",
      placeholder: "Ask about your accounts…",
      v: mod.PROTOCOL_VERSION,
    });
  });

  it("lets an explicit init base win over the load base", async () => {
    const fake = fakeGlobal();
    window.Concatflow = fake.global;
    const cf = await mod.loadConcatflow();
    cf.init({ siteToken: "site_1", base: "http://localhost:3000" });
    expect(fake.init.mock.calls[0]?.[0]).toMatchObject({ base: "http://localhost:3000", siteToken: "site_1" });
  });

  it("strips a trailing slash from an init base: the widget matches message origins exactly", async () => {
    const fake = fakeGlobal();
    window.Concatflow = fake.global;
    const cf = await mod.loadConcatflow();
    cf.init({ siteToken: "site_1", base: "http://localhost:3000/" });
    expect(fake.init.mock.calls[0]?.[0]).toMatchObject({ base: "http://localhost:3000" });
  });

  it.each<[string, unknown, RegExp]>([
    ["neither token", {}, /exactly one/],
    ["both tokens", { session: "a", siteToken: "b" }, /exactly one/],
    ["empty session", { session: "" }, /non-empty/],
    ["bad launcher", { session: "a", launcher: "modal" }, /launcher/],
    ["bad theme", { session: "a", theme: "neon" }, /theme/],
    ["expiry handler on public door", { siteToken: "a", onSessionExpired: async () => "x" }, /only applies/],
    ["non-function expiry handler", { session: "a", onSessionExpired: "x" }, /must be a function/],
    ["bad target", { session: "a", target: 42 }, /target/],
    ["non-string accent", { session: "a", accent: 1 }, /accent/],
    ["non-string placeholder", { session: "a", placeholder: null }, /placeholder/],
  ])("refuses %s without calling the hosted script", async (_name, options, msg) => {
    const fake = fakeGlobal();
    window.Concatflow = fake.global;
    const cf = await mod.loadConcatflow();
    expect(() => cf.init(options as ConcatflowOptions)).toThrow(msg);
    expect(fake.init).not.toHaveBeenCalled();
  });
});
