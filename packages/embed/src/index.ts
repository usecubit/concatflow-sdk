/** The origin serving `widget.js` and the assistant iframe. */
export const DEFAULT_BASE = "https://dash.usecubit.io";

/**
 * Version of the options contract this package speaks to the hosted script. The hosted
 * script keeps honouring older versions, so an old copy of this package keeps working.
 */
export const PROTOCOL_VERSION = 1;

export type Launcher = "bubble" | "bar";
export type Theme = "auto" | "light" | "dark";

interface CommonOptions {
  launcher?: Launcher;
  /** Where to render the inline bar: an element or a CSS selector. */
  target?: HTMLElement | string;
  /** Concatflow origin; defaults to the one `widget.js` was loaded from. */
  base?: string;
  theme?: Theme;
}

/** Per-user door: a session token opened by your server with `@concatflow/node`. */
export interface SessionOptions extends CommonOptions {
  session: string;
  siteToken?: never;
  /** Called when the session expires; resolve with a fresh token from your server. */
  onSessionExpired?: () => Promise<string>;
}

/** Public door: the assistant's site token, no end-customer identity. */
export interface SiteTokenOptions extends CommonOptions {
  siteToken: string;
  session?: never;
  onSessionExpired?: never;
}

export type ConcatflowOptions = SessionOptions | SiteTokenOptions;

export interface ConcatflowInstance {
  setSession(token: string): void;
  open(): void;
  close(): void;
  destroy(): void;
}

export interface ConcatflowGlobal {
  init(options: ConcatflowOptions): ConcatflowInstance;
}

declare global {
  interface Window {
    Concatflow?: ConcatflowGlobal;
  }
}

const LAUNCHERS: readonly string[] = ["bubble", "bar"];
const THEMES: readonly string[] = ["auto", "light", "dark"];

/** Throws a TypeError naming the first problem in `options`. */
export function validateOptions(options: ConcatflowOptions): void {
  const o = (options ?? {}) as Partial<Record<keyof SessionOptions | "siteToken", unknown>>;
  const hasSession = o.session !== undefined;
  const hasSite = o.siteToken !== undefined;
  if (hasSession === hasSite) {
    throw new TypeError("Concatflow: pass exactly one of `session` or `siteToken`.");
  }
  const token = hasSession ? o.session : o.siteToken;
  if (typeof token !== "string" || token === "") {
    throw new TypeError(`Concatflow: \`${hasSession ? "session" : "siteToken"}\` must be a non-empty string.`);
  }
  if (o.launcher !== undefined && !LAUNCHERS.includes(o.launcher as string)) {
    throw new TypeError(`Concatflow: \`launcher\` must be one of ${LAUNCHERS.join(", ")}.`);
  }
  if (o.theme !== undefined && !THEMES.includes(o.theme as string)) {
    throw new TypeError(`Concatflow: \`theme\` must be one of ${THEMES.join(", ")}.`);
  }
  if (o.onSessionExpired !== undefined) {
    if (hasSite) throw new TypeError("Concatflow: `onSessionExpired` only applies to `session`.");
    if (typeof o.onSessionExpired !== "function") {
      throw new TypeError("Concatflow: `onSessionExpired` must be a function returning Promise<string>.");
    }
  }
  if (o.target !== undefined && typeof o.target !== "string" && !(o.target instanceof HTMLElement)) {
    throw new TypeError("Concatflow: `target` must be an HTMLElement or a CSS selector.");
  }
}

let loading: { base: string; promise: Promise<ConcatflowGlobal> } | undefined;

/**
 * Loads `${base}/widget.js` once and resolves with a typed `Concatflow` whose `init` validates
 * its options. Safe to call many times: every call shares the same promise.
 */
export function loadConcatflow({ base = DEFAULT_BASE }: { base?: string } = {}): Promise<ConcatflowGlobal> {
  base = base.replace(/\/+$/, "");
  if (loading) {
    if (loading.base !== base) {
      return Promise.reject(new Error(`Concatflow: widget.js is already loaded from ${loading.base}.`));
    }
    return loading.promise;
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Concatflow: loadConcatflow() must run in the browser."));
  }
  const promise = injectScript(`${base}/widget.js`).then((raw) => wrap(raw, base));
  // A failed load (offline, blocked) can be retried by calling again.
  promise.catch(() => {
    if (loading?.promise === promise) loading = undefined;
  });
  loading = { base, promise };
  return promise;
}

function injectScript(src: string): Promise<ConcatflowGlobal> {
  return new Promise((resolve, reject) => {
    if (window.Concatflow) return resolve(window.Concatflow);
    const done = () =>
      window.Concatflow
        ? resolve(window.Concatflow)
        : reject(new Error(`Concatflow: ${src} loaded but did not define window.Concatflow.`));
    const failed = () => reject(new Error(`Concatflow: failed to load ${src}.`));
    // Reuse a <script> tag the page already has (snippet install), else add one.
    let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", failed, { once: true });
  });
}

function wrap(raw: ConcatflowGlobal, base: string): ConcatflowGlobal {
  return {
    init(options) {
      validateOptions(options);
      // `v` tells the hosted script which options contract this package speaks.
      const versioned = { base, ...options, v: PROTOCOL_VERSION };
      return raw.init(versioned);
    },
  };
}

