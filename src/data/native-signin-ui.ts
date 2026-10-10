import { AppWebSignInSession } from "@mdbase-dev/sdk/app-host";
import type {
  AppWebSignInSessionOptions,
  AppWebSignInSnapshot,
  AppWebSignInPortal,
} from "@mdbase-dev/sdk/app-host";

export type NativeSignInSession = Pick<
  AppWebSignInSession<never>,
  | "getSnapshot"
  | "subscribe"
  | "start"
  | "authorize"
  | "renewExpiredPairing"
  | "forget"
  | "close"
  | "setForeground"
>;

export const signInCopy = Object.freeze({
  signIn: "Sign in",
  waiting: "Waiting for approval in the mdbase tab…",
  reopen: "Open the mdbase tab again",
  tabBlocked: "Your browser blocked the sign-in tab.",
  openSignIn: "Open sign-in",
  interrupted: "Sign-in was interrupted. Please try again.",
  signOut: "Sign out",
  unavailable: "Opening collections isn't available in this build yet.",
});

export class SignInTabBlocked extends Error {
  constructor() {
    super(signInCopy.tabBlocked);
  }
}

/** UI-only public portal capability. The SDK supplies the validated URI. */
export function openSignInPortal(): AppWebSignInPortal {
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new SignInTabBlocked();
  tab.opener = null;
  return {
    navigate(uri) {
      tab.location.replace(uri);
    },
    close() {
      tab.close();
    },
  };
}

/** UI-owned tab reservation for asynchronous SDK start/expiry renewal. */
export function createSignInPortalUi() {
  let reserved: AppWebSignInPortal | null = null;
  return {
    reserve() {
      if (!reserved) reserved = openSignInPortal();
    },
    open() {
      const portal = reserved ?? openSignInPortal();
      reserved = null;
      return portal;
    },
    cancel() {
      reserved?.close();
      reserved = null;
    },
  };
}

// React presentation identity only, never a native actor/record/mutation ID.
let nextViewKey = 0;

export interface NativeSignInBinding {
  session: NativeSignInSession;
  portal: ReturnType<typeof createSignInPortalUi>;
  /** UI-only React identity. */
  viewKey: number;
}

/** Only a public SDK constructor and UI portal; no collection/SQL factory. */
export function createNativeSignIn(
  options: Omit<
    AppWebSignInSessionOptions<never>,
    "openPortal" | "openCollection" | "autoSelect"
  >,
): NativeSignInBinding {
  options.signal.throwIfAborted();
  const portal = createSignInPortalUi();
  const session = new AppWebSignInSession<never>({
    ...options,
    openPortal: portal.open,
    openCollection: unavailableCollection,
    autoSelect: "never",
  });
  return { session, portal, viewKey: ++nextViewKey };
}

/** Reserve in the user gesture BEFORE any asynchronous SDK renewal/start. */
export async function authorizeNativeSignIn(
  session: NativeSignInSession,
  portal: ReturnType<typeof createSignInPortalUi>,
) {
  portal.reserve();
  try {
    if (session.getSnapshot().status === "not_started") await session.start();
    if (session.getSnapshot().problem === "expired")
      await session.renewExpiredPairing();
    return await session.authorize();
  } catch (error) {
    portal.cancel();
    throw error;
  }
}

/** Explicit pre-factory boundary, not a pretend collection or setup result. */
export const unavailableCollection: AppWebSignInSessionOptions<never>["openCollection"] =
  async ({ signal }) => {
    signal.throwIfAborted();
    throw new Error(signInCopy.unavailable);
  };

export function signInPresentation(
  snapshot: AppWebSignInSnapshot,
  appName: string,
  problem: "tab_blocked" | "interrupted" | null = null,
) {
  const paired =
    snapshot.status !== "closed" && snapshot.signIn?.state === "paired";
  const email = paired ? snapshot.signIn?.accountEmail : null;
  const identity = email ? `Signed in as ${email}` : null;
  const selected = snapshot.collections.find(
    ({ collectionId }) => collectionId === snapshot.selectedCollectionId,
  );
  const waiting = snapshot.status === "authorizing" && problem === null;
  const interrupted =
    problem === "interrupted" || snapshot.status === "blocked";
  const message =
    problem === "tab_blocked"
      ? signInCopy.tabBlocked
      : interrupted
        ? signInCopy.interrupted
        : waiting
          ? signInCopy.waiting
          : snapshot.status === "opening" && selected
            ? `Signed in. Opening ${selected.displayName}…`
            : (identity ??
              (paired
                ? signInCopy.unavailable
                : `Sign in with your mdbase account to sync ${appName} across your devices.`));
  return {
    message,
    identity: identity === message ? null : identity,
    waiting,
    paired,
    unavailable: paired && message !== signInCopy.unavailable,
    error: problem !== null || snapshot.status === "blocked",
    action:
      problem === "tab_blocked" ? signInCopy.openSignIn : signInCopy.signIn,
    disabled: ["starting", "opening", "closed"].includes(snapshot.status),
  };
}
