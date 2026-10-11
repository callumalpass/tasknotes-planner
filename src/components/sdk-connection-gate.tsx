import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  describeError,
  type MdbaseApplicationEntry,
  type MdbaseClient,
  type MdbaseErrorDescription,
} from "@mdbase-dev/sdk";
import { NextPlannerRepository } from "../data/next-planner-repository";
import { Planner } from "./planner";

/** The SDK's public structural entry (production: `MdbaseConnect`), so test
 * fixtures need no private constructor state. This does not wrap or replace the
 * borrowed records client. */
export type PlannerSdk = MdbaseApplicationEntry;

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
          await application.chooseAnother({ signal: scope.signal });
          scope.signal.throwIfAborted();
        }}
      />
    );
  }

  const unavailable = snapshot.problem === "application_not_yet_available";
  const closed = snapshot.status === "closed";
  const selection = snapshot.selection.state;
  const waiting =
    snapshot.status === "authorizing" || selection === "approving";
  const approval = !closed && selection === "approval_required";
  const invalid = !closed && selection === "invalid";
  const readinessProblem =
    snapshot.readiness.problem !== null ||
    snapshot.readiness.assessment?.problem != null;
  const incompatible = snapshot.readiness.assessment?.status === "incompatible";
  const opening =
    !interrupted &&
    !readinessProblem &&
    !incompatible &&
    (["starting", "opening"].includes(snapshot.status) ||
      snapshot.readiness.checking);
  const unchecked =
    snapshot.status === "ready" &&
    !opening &&
    snapshot.readiness.assessment === null;
  const retired =
    snapshot.status === "ready" &&
    !opening &&
    !readinessProblem &&
    snapshot.readiness.assessment?.status === "ready";
  const retryReadiness =
    !closed &&
    !unavailable &&
    !waiting &&
    !incompatible &&
    (readinessProblem || unchecked);
  const setup =
    !closed &&
    !unavailable &&
    (snapshot.status === "setup_required" ||
      snapshot.readiness.assessment?.status === "setup_required");
  const paired = !closed && snapshot.signIn?.state === "paired";
  const signIn = paired ? snapshot.signIn : null;
  const identity = signIn?.accountEmail
    ? `Signed in as ${signIn.accountEmail}`
    : signIn?.accountProvider === "github" && signIn.accountLogin
      ? `Signed in as ${signIn.accountLogin} on GitHub`
      : null;
  // Settled SDK problems (blocked start, readiness, incompatible): the SDK's
  // shared copy and its one suggested action, never raw codes or endless Opening.
  const problem =
    closed || unavailable || waiting || invalid || approval
      ? null
      : snapshot.status === "blocked" || readinessProblem || incompatible
        ? describeError(snapshot)
        : null;
  const recovery = problem
    ? recoveryAction(problem, {
        readiness: readinessProblem && snapshot.status !== "blocked",
        authorize: (options) => application.authorize(options),
        restart: (options) => application.start(options),
        assess: (options) => application.assess(options),
        approve: (options) => application.approve(undefined, options),
        chooseAnother: (options) => application.chooseAnother(options),
        configure: (options) => application.configure(options),
      })
    : null;
  const error =
    interrupted ||
    snapshot.status === "blocked" ||
    invalid ||
    readinessProblem ||
    incompatible ||
    retired;
  const message = problem
    ? problem.message
    : unavailable
      ? "Opening collections isn't available in this build yet."
      : closed
        ? "Planner has signed out. Reload to sign in again."
        : waiting
          ? "Waiting for approval in the mdbase tab…"
          : invalid
            ? "This link doesn't name a collection Planner can open."
            : approval
              ? "Planner isn't approved for the collection in this link yet."
              : incompatible
                ? "This collection isn't compatible with TaskNotes Planner. Choose another collection."
                : readinessProblem
                  ? "Planner couldn't check this collection. Check again or choose another collection."
                  : unchecked
                    ? "This collection hasn't been checked yet. Check again before planning."
                    : retired
                      ? "The connection to this collection has changed. Choose the collection again."
                      : setup
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
        {problem ? <h2>{problem.title}</h2> : null}
        <p role={error ? "alert" : "status"} aria-live="polite">
          {message}
        </p>
        <div className="welcome-actions">
          {!closed &&
          !unavailable &&
          !waiting &&
          !opening &&
          !problem &&
          !retryReadiness &&
          !incompatible &&
          !retired ? (
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
          {recovery && "href" in recovery ? (
            <a className="primary-action" href={recovery.href}>
              {recovery.label}
            </a>
          ) : recovery ? (
            <button
              className="primary-action"
              type="button"
              disabled={working}
              onClick={() =>
                recovery.reload
                  ? window.location.reload()
                  : void act(recovery.run)
              }
            >
              {recovery.label}
            </button>
          ) : null}
          {retryReadiness && !problem ? (
            <button
              className="primary-action"
              type="button"
              disabled={working}
              onClick={() => void act((options) => application.assess(options))}
            >
              Check again
            </button>
          ) : null}
          {approval ? (
            <button
              className="primary-action"
              type="button"
              disabled={working}
              onClick={() =>
                void act((options) => application.approve(undefined, options))
              }
            >
              Approve this collection
            </button>
          ) : null}
          {setup && recovery?.label !== "Set up" ? (
            <button
              className="primary-action"
              type="button"
              disabled={working}
              onClick={() =>
                void act((options) => application.configure(options))
              }
            >
              Set up TaskNotes Planner
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
          {((snapshot.selectedCollectionId ||
            incompatible ||
            retired ||
            retryReadiness) &&
            !closed) ||
          approval ||
          invalid ? (
            <button
              className="text-action"
              type="button"
              disabled={working}
              onClick={() =>
                void act((options) => application.chooseAnother(options))
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

type Run = (options: { signal: AbortSignal }) => Promise<unknown>;
type Recovery =
  | { label: string; href: string }
  | { label: string; run: Run; reload?: false }
  | { label: string; run: Run; reload: true };

/** The SDK's suggested action as one Planner control. Readiness problems
 * re-check rather than reload; an unknown action offers no pretend fix. */
function recoveryAction(
  problem: MdbaseErrorDescription,
  ports: {
    readiness: boolean;
    authorize: Run;
    restart: Run;
    assess: Run;
    approve: Run;
    chooseAnother: Run;
    configure: Run;
  },
): Recovery | null {
  const label = problem.actionLabel ?? "Try again";
  switch (problem.action) {
    case "sign_in":
      return { label, run: ports.authorize };
    case "approve":
      return { label, run: ports.approve };
    case "set_up":
      return { label, run: ports.configure };
    case "choose_collection":
      return { label, run: ports.chooseAnother };
    case "update_app":
      // A web app updates by reloading when the SDK names no update page.
      return problem.updateUrl
        ? { label, href: problem.updateUrl }
        : { label, run: ports.restart, reload: true };
    case "retry":
    case "check_connection":
    case "reload":
      if (ports.readiness) return { label: "Check again", run: ports.assess };
      return problem.action === "reload"
        ? { label, run: ports.restart, reload: true }
        : { label, run: ports.restart };
    default:
      return null;
  }
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
