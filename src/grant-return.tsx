import type { ReactNode } from "react";

import SdkApp from "./components/sdk-app";

type AppGrantModule = Pick<
  typeof import("@mdbase-dev/sdk/app-grant"),
  "deliverAppGrantCallback"
>;

/** The Private collection consent popup lands back on the redirect URI with
 * `state` and `code` or `error`. */
export function isAppGrantCallback(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.searchParams.has("state") &&
      (url.searchParams.has("code") || url.searchParams.has("error"))
    );
  } catch {
    return false;
  }
}

/** Hand the consent result to the waiting Planner tab (its SDK closes this
 * popup). The grant code loads only here, outside the main bundle. */
export async function deliverAppGrantReturn(
  href: string,
  load: () => Promise<AppGrantModule> = () =>
    import("@mdbase-dev/sdk/app-grant"),
): Promise<void> {
  (await load()).deliverAppGrantCallback(href);
}

/** What the page renders. A consent popup return delivers its result without
 * starting a second SDK entry; the original SDK owns close only after Native
 * finish and original custody ACK. */
export function pageFor(
  href: string,
  deliver: (href: string) => Promise<void> = deliverAppGrantReturn,
): ReactNode {
  if (!isAppGrantCallback(href)) return <SdkApp />;
  void deliver(href).catch(() => {});
  return <p className="grant-return">You can close this window.</p>;
}
