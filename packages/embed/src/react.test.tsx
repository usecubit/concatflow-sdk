// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConcatflowGlobal } from "./index.js";

// Fresh module per test: the loader caches widget.js for the page's lifetime.
let ConcatflowAssistant: typeof import("./react.js").ConcatflowAssistant;
beforeEach(async () => {
  vi.resetModules();
  ({ ConcatflowAssistant } = await import("./react.js"));
});

function installFake() {
  const instance = { setSession: vi.fn(), open: vi.fn(), close: vi.fn(), destroy: vi.fn() };
  const init = vi.fn((_o: Record<string, unknown>) => instance);
  window.Concatflow = { init } as unknown as ConcatflowGlobal;
  return { init, instance };
}

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
  delete window.Concatflow;
});

describe("<ConcatflowAssistant />", () => {
  it("inits a bubble with the session, renders nothing, destroys on unmount", async () => {
    const { init, instance } = installFake();
    const { container, unmount } = render(<ConcatflowAssistant session="tok_1" launcher="bubble" />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    expect(init.mock.calls[0]?.[0]).toMatchObject({ session: "tok_1", launcher: "bubble", v: 1 });
    expect(init.mock.calls[0]?.[0]).not.toHaveProperty("target");
    expect(container.innerHTML).toBe("");

    unmount();
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it("passes a new session prop to the running widget instead of re-initialising", async () => {
    const { init, instance } = installFake();
    const { rerender } = render(<ConcatflowAssistant session="tok_1" />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));

    rerender(<ConcatflowAssistant session="tok_2" />);
    expect(instance.setSession).toHaveBeenCalledWith("tok_2");
    expect(init).toHaveBeenCalledTimes(1);
    expect(instance.destroy).not.toHaveBeenCalled();
  });

  it("renders the bar inline in its own div and targets it", async () => {
    const { init } = installFake();
    const { container } = render(<ConcatflowAssistant siteToken="site_1" launcher="bar" className="cf-bar" />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const div = container.querySelector("div.cf-bar");
    expect(div).not.toBeNull();
    expect(init.mock.calls[0]?.[0]).toMatchObject({ siteToken: "site_1", launcher: "bar", target: div });
  });

  it("re-initialises when the launcher changes", async () => {
    const { init, instance } = installFake();
    const { rerender } = render(<ConcatflowAssistant session="tok" launcher="bubble" />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    rerender(<ConcatflowAssistant session="tok" launcher="bar" />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(2));
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it("calls the latest onSessionExpired handler", async () => {
    const { init } = installFake();
    const first = vi.fn(async () => "old");
    const second = vi.fn(async () => "fresh");
    const { rerender } = render(<ConcatflowAssistant session="tok" onSessionExpired={first} />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    rerender(<ConcatflowAssistant session="tok" onSessionExpired={second} />);

    const handler = init.mock.calls[0]?.[0].onSessionExpired as () => Promise<string>;
    await expect(handler()).resolves.toBe("fresh");
    expect(first).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("does not init if unmounted before widget.js finished loading", async () => {
    const { unmount } = render(<ConcatflowAssistant session="tok" base="https://slow.test" />);
    unmount();
    const { init, instance } = installFake();
    await act(async () => {
      document.querySelector('script[src="https://slow.test/widget.js"]')!.dispatchEvent(new Event("load"));
    });
    expect(init).not.toHaveBeenCalled();
    expect(instance.destroy).not.toHaveBeenCalled();
  });

  it("reports invalid options through onError", async () => {
    installFake();
    const onError = vi.fn();
    render(<ConcatflowAssistant session="" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0].message).toMatch(/non-empty/);
  });
});
