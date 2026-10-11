import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MdbaseClient, MdbaseConnect } from "@mdbase-dev/sdk";
import { NextPlannerRepository } from "../data/next-planner-repository";
import { Planner } from "./planner";

/** Only the actual public entry's two methods, so test fixtures need no private
 * constructor state. This does not wrap or replace the borrowed records client. */
export type PlannerSdk = Pick<MdbaseConnect, "application" | "connection">;

const viewKeys = new WeakMap<PlannerSdk, number>();
let nextViewKey = 0;
function viewKey(sdk: PlannerSdk) {
  let key = viewKeys.get(sdk);
  if (key === undefined) {
    key = ++nextViewKey;
    viewKeys.set(sdk, key);
  }
  return key;
}

/** SDK owns startup, popup, selection, readiness, storage and physical close. */
export function SdkConnectionGate(props: {
  sdk: PlannerSdk;
  onDemo(): void;
  onSignedOut?(): void;
}) {
  return <SdkApplicationView key={viewKey(props.sdk)} {...props} />;
}

function SdkApplicationView({
  sdk,
  onDemo,
  onSignedOut,
}: {
  sdk: PlannerSdk;
  onDemo(): void;
  onSignedOut?(): void;
}) {
  const application = sdk.application();
  const snapshot = useSyncExternalStore(
    (listener) => application.subscribe(listener),
    () => application.getSnapshot(),
    () => application.getSnapshot(),
  );
  const caller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [interrupted, setInterrupted] = useState(false);

  useEffect(() => {
    const scope = new AbortController();
    caller.current = scope;
    const foreground = () => {
      if (scope.signal.aborted || application.getSnapshot().status === "closed")
        return;
      try {
        application.setForeground(document.visibilityState === "visible");
      } catch {
        // An unavailable or retired SDK owner cannot be restarted by this UI.
      }
    };
    document.addEventListener("visibilitychange", foreground);
    foreground();
    queueMicrotask(() => {
      if (
        scope.signal.aborted ||
        application.getSnapshot().status !== "not_started"
      )
        return;
      void application.start({ signal: scope.signal }).catch(() => {
        if (!scope.signal.aborted) setInterrupted(true);
      });
    });
    return () => {
      scope.abort();
      document.removeEventListener("visibilitychange", foreground);
      try {
        if (application.getSnapshot().status !== "closed")
          application.setForeground(false);
      } catch {
        // Closed/unavailable owner; never replace it or qualify shutdown here.
      }
      // Borrowed singleton: the actual SDK owner handles shutdown/HMR.
    };
  }, [application]);

  const act = async (
    action: (options: { signal: AbortSignal }) => Promise<unknown>,
  ) => {
    const scope = caller.current;
    if (!scope || scope.signal.aborted || busy.current) return;
    busy.current = true;
    setWorking(true);
    setInterrupted(false);
    try {
      await action({ signal: scope.signal });
    } catch {
      if (!scope.signal.aborted) setInterrupted(true);
    } finally {
      if (!scope.signal.aborted) {
        busy.current = false;
        setWorking(false);
      }
    }
  };

  const selected = snapshot.collections.find(
    (collection) => collection.collectionId === snapshot.selectedCollectionId,
  );
  const connection =
    snapshot.status === "ready" && selected
      ? sdk.connection(selected.collectionId)
      : null;
  const ready =
    connection &&
    connection.id === selected?.collectionId &&
    connection.records.hello.collection === connection.id &&
    connection.isCurrent() &&
    !snapshot.readiness.checking &&
    snapshot.readiness.problem === null &&
    snapshot.readiness.assessment?.status === "ready" &&
    snapshot.readiness.assessment.problem === null;
  if (ready && connection && selected) {
    return (
      <SdkPlannerView
        key={`${connection.id}:${connection.generation}`}
        client={connection.records}
        displayName={selected.displayName}
        onChangeCollection={async () => {
          const scope = caller.current;
          if (!scope || scope.signal.aborted || !connection.isCurrent())
            throw new Error(
              "This collection has changed. Choose a collection again.",
            );
          await application.clearSelection({ signal: scope.signal });
          scope.signal.throwIfAborted();
        }}
      />
    );
  }

  const unavailable = snapshot.problem === "application_not_yet_available";
  const closed = snapshot.status === "closed";
  const waiting = snapshot.status === "authorizing";
  const opening =
    ["starting", "opening"].includes(snapshot.status) ||
    snapshot.readiness.checking;
  const paired = !closed && snapshot.signIn?.state === "paired";
  const signIn = paired ? snapshot.signIn : null;
  const identity = signIn?.accountEmail
    ? `Signed in as ${signIn.accountEmail}`
    : signIn?.accountProvider === "github" && signIn.accountLogin
      ? `Signed in as ${signIn.accountLogin} on GitHub`
      : null;
  const error = interrupted || snapshot.status === "blocked";
  const message = unavailable
    ? "Opening collections isn't available in this build yet."
    : closed
      ? "Planner has signed out. Reload to sign in again."
      : waiting
        ? "Waiting for approval in the mdbase tab…"
        : snapshot.status === "setup_required"
          ? "This collection needs TaskNotes setup before planning."
          : error
            ? "Planner could not open this collection. Please try again."
            : opening || snapshot.status === "ready"
              ? `Opening ${selected?.displayName ?? "your collection"}…`
              : "Sign in with your mdbase account to sync TaskNotes Planner across your devices.";

  return (
    <main className="welcome">
      <section className="welcome-intro" aria-labelledby="sdk-signin-title">
        <div className="brand-lockup">
          <img alt="" src="/tasknotes-mark.svg" />
          <span>TaskNotes Planner</span>
        </div>
        <h1 id="sdk-signin-title">Plan tasks on a timeline.</h1>
        {identity ? <p>{identity}</p> : null}
        <p role={error ? "alert" : "status"} aria-live="polite">
          {message}
        </p>
        <div className="welcome-actions">
          {!closed && !unavailable && !waiting && !opening ? (
            <button
              className="primary-action"
              type="button"
              disabled={working}
              onClick={() =>
                void act((options) => application.authorize(options))
              }
            >
              Sign in
            </button>
          ) : null}
          {paired ? (
            <button
              className="text-action"
              type="button"
              disabled={working}
              onClick={() =>
                void act(async ({ signal }) => {
                  await application.close();
                  signal.throwIfAborted();
                  onSignedOut?.();
                })
              }
            >
              Sign out
            </button>
          ) : null}
          {snapshot.selectedCollectionId && !closed ? (
            <button
              className="text-action"
              type="button"
              disabled={working}
              onClick={() => {
                const id = snapshot.selectedCollectionId;
                if (id) void act((options) => application.forget(id, options));
              }}
            >
              Forget collection
            </button>
          ) : null}
          {snapshot.selectedCollectionId && !closed ? (
            <button
              className="text-action"
              type="button"
              disabled={working}
              onClick={() =>
                void act((options) => application.clearSelection(options))
              }
            >
              Choose another collection
            </button>
          ) : null}
          <button className="text-action" type="button" onClick={onDemo}>
            Try sample tasks
          </button>
        </div>
        {!closed && !unavailable ? (
          <div className="welcome-actions">
            {snapshot.collections.map((collection) => (
              <button
                type="button"
                key={collection.collectionId}
                disabled={working || opening || waiting}
                onClick={() =>
                  void act((options) =>
                    application.select(collection.collectionId, options),
                  )
                }
              >
                {collection.displayName}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function SdkPlannerView({
  client,
  displayName,
  onChangeCollection,
}: {
  client: MdbaseClient;
  displayName: string;
  onChangeCollection(): Promise<void>;
}) {
  const [view, setView] = useState<{
    client: MdbaseClient;
    name: string;
    repository: NextPlannerRepository;
  } | null>(null);
  useEffect(() => {
    const repository = new NextPlannerRepository(client, displayName);
    let active = true;
    queueMicrotask(() => {
      if (active) setView({ client, name: displayName, repository });
    });
    return () => {
      active = false;
      repository.dispose();
    };
  }, [client, displayName]);
  // An old repository is never rendered for a changed client/name. Effects are
  // replay-safe: every owned repo is disposed, never the SDK's borrowed client.
  if (!view || view.client !== client || view.name !== displayName)
    return (
      <main className="welcome">
        <p role="status">Opening {displayName}…</p>
      </main>
    );
  return (
    <Planner
      repository={view.repository}
      onChangeCollection={onChangeCollection}
    />
  );
}
