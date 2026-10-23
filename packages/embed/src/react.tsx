import { useEffect, useRef, type CSSProperties } from "react";
import {
  loadConcatflow,
  type ConcatflowInstance,
  type SessionOptions,
  type SiteTokenOptions,
} from "./index.js";

interface ComponentProps {
  /** Called if widget.js fails to load or the options are invalid. Defaults to console.error. */
  onError?: (error: Error) => void;
  /** Applied to the inline bar's container (launcher="bar" only). */
  className?: string;
  style?: CSSProperties;
}

export type ConcatflowAssistantProps =
  | (Omit<SessionOptions, "target"> & ComponentProps)
  | (Omit<SiteTokenOptions, "target"> & ComponentProps);

/**
 * Mounts the Concatflow assistant. `launcher="bubble"` (default) floats over the page and
 * renders nothing here; `launcher="bar"` renders inline in a div this component owns.
 * A new `session` prop is passed to the running widget; unmounting destroys it.
 */
export function ConcatflowAssistant(props: ConcatflowAssistantProps) {
  const { session, siteToken, launcher, theme, base, onSessionExpired, onError, className, style } = props;
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<ConcatflowInstance | null>(null);
  // Latest values, read when the widget (re)initialises, without re-running the effect.
  const latest = useRef({ session, onSessionExpired, onError });
  latest.current = { session, onSessionExpired, onError };

  const door = siteToken === undefined ? "session" : "site";
  const hasExpiryHandler = onSessionExpired !== undefined;

  useEffect(() => {
    let cancelled = false;
    let created: ConcatflowInstance | null = null;
    loadConcatflow(base === undefined ? {} : { base })
      .then((cf) => {
        if (cancelled) return;
        const common = {
          ...(launcher && { launcher }),
          ...(theme && { theme }),
          ...(base && { base }),
          ...(launcher === "bar" && container.current && { target: container.current }),
        };
        created =
          door === "site"
            ? cf.init({ ...common, siteToken: siteToken as string })
            : cf.init({
                ...common,
                session: latest.current.session as string,
                ...(hasExpiryHandler && {
                  onSessionExpired: () => latest.current.onSessionExpired!(),
                }),
              });
        instance.current = created;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const err = error instanceof Error ? error : new Error(String(error));
        (latest.current.onError ?? console.error)(err);
      });
    return () => {
      cancelled = true;
      created?.destroy();
      if (instance.current === created) instance.current = null;
    };
  }, [door, siteToken, launcher, theme, base, hasExpiryHandler]);

  useEffect(() => {
    if (session !== undefined) instance.current?.setSession(session);
  }, [session]);

  return launcher === "bar" ? <div ref={container} className={className} style={style} /> : null;
}
