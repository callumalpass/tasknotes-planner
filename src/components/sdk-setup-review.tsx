import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeError,
  isMdbaseError,
  type MdbaseApplication,
  type MdbaseSetupPlan,
} from "@mdbase-dev/sdk";

type State =
  | { kind: "planning"; note?: string }
  | { kind: "review"; plan: MdbaseSetupPlan; note?: string }
  | { kind: "applying"; plan: MdbaseSetupPlan }
  | { kind: "failed"; message: string };

const changedNote =
  "This collection changed while you were reviewing. Nothing was changed. Here are the updated changes.";
const unknownNote =
  "Planner couldn't confirm whether setup finished. Here is the collection as it is now.";

/** Only a known refusal proves nothing was written. A lost reply after the
 * request was sent, or an error that isn't an SDK error, may have applied. */
function setupOutcome(error: unknown): "changed" | "unknown" | "failed" {
  if (!isMdbaseError(error)) return "unknown";
  if (error.reason === "setup_changed") return "changed";
  return error.code === "outcome_unknown" || error.mutationId !== undefined
    ? "unknown"
    : "failed";
}
/** Nothing to review: no changes, no conflicts and no refusal. */
const quiet = (plan: MdbaseSetupPlan): boolean =>
  !plan.refusal && plan.changes.length === 0 && plan.conflicts.length === 0;
/** Version parts compared numerically, prerelease tags included. */
const versionParts = (version: string): number[] =>
  version.split(/[.+-]/).flatMap((part) => (/^\d+$/.test(part) ? [+part] : []));
const newer = (installed: string, ours: string): boolean => {
  const a = versionParts(installed);
  const b = versionParts(ours);
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
};
/** A blocked plan must say why, even when the SDK gives no refusal. */
function blockedSetupReason(plan: MdbaseSetupPlan): string | null {
  if (plan.canApply || plan.status === "current" || plan.refusal) return null;
  const ahead = plan.packs.find(
    (pack) =>
      pack.status === "conflict" &&
      pack.installedVersion !== undefined &&
      newer(pack.installedVersion, pack.version),
  );
  if (ahead)
    return `This collection already uses a newer version of ${ahead.id} (${ahead.installedVersion}) than this version of Planner supports (${ahead.version}). Update Planner to continue. Nothing was changed.`;
  return "Planner can't set up this collection as it is. Nothing was changed.";
}
const describe = (error: unknown, fallback: string): string =>
  describeError(error)?.message ?? fallback;

/** One review before setup: the SDK's plan summary and plain per-change
 * messages, then Confirm applies exactly that plan. Nothing is written
 * until Confirm. A changed collection is planned again for a fresh review. */
export function SdkSetupReview({
  application,
  displayName,
  onCancel,
  onApplied,
}: {
  application: Pick<MdbaseApplication, "setup" | "configure">;
  displayName: string;
  onCancel(): void;
  onApplied?(): void;
}) {
  const [state, setState] = useState<State>({ kind: "planning" });
  const adopt = useRef<Readonly<Record<string, string>> | undefined>(undefined);
  const scope = useRef<AbortController | null>(null);
  const applied = useRef(onApplied);
  useEffect(() => {
    applied.current = onApplied;
  });

  const plan = useCallback(
    async (note?: string) => {
      const choice = adopt.current;
      const signal = scope.current?.signal;
      if (!signal || signal.aborted) return;
      setState({ kind: "planning", note });
      try {
        const next = await application.setup.plan({
          signal,
          ...(choice ? { adopt: choice } : {}),
        });
        if (signal.aborted) return;
        // Nothing to review keeps the plain configure() path, unless this is
        // a re-assessment after an unconfirmed outcome that must be shown.
        if (quiet(next) && note === undefined) {
          await application.configure({ signal });
          if (!signal.aborted) applied.current?.();
          return;
        }
        setState({ kind: "review", plan: next, note });
      } catch (error) {
        if (!signal.aborted)
          setState({
            kind: "failed",
            message: describe(
              error,
              "Planner couldn't check what setup would change.",
            ),
          });
      }
    },
    [application],
  );

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    // StrictMode replays effects; only the surviving scope plans.
    queueMicrotask(() => {
      if (!controller.signal.aborted) void plan();
    });
    return () => controller.abort();
  }, [plan]);

  const confirm = async (reviewed: MdbaseSetupPlan) => {
    const signal = scope.current?.signal;
    if (!signal || signal.aborted) return;
    setState({ kind: "applying", plan: reviewed });
    try {
      await application.setup.apply(reviewed, { signal });
      if (!signal.aborted) onApplied?.();
    } catch (error) {
      if (signal.aborted) return;
      const outcome = setupOutcome(error);
      if (outcome !== "failed")
        return void plan(outcome === "changed" ? changedNote : unknownNote);
      setState({
        kind: "failed",
        message: describe(
          error,
          "Setup couldn't be completed. Please try again.",
        ),
      });
    }
  };
  const chooseAppVersion = (reviewed: MdbaseSetupPlan) => {
    adopt.current = reviewed.adoptable;
    void plan();
  };

  const shown =
    state.kind === "review" || state.kind === "applying" ? state.plan : null;
  const busy = state.kind === "planning" || state.kind === "applying";
  const adoptable =
    shown?.refusal?.code === "setup_conflict" &&
    shown.conflicts.length > 0 &&
    shown.conflicts.every((c) => c.adoptable);

  return (
    <section
      aria-labelledby="sdk-setup-review-title"
      className="setup-review sdk-setup-review"
    >
      <header>
        <span>COLLECTION SETUP</span>
        <strong>{displayName}</strong>
      </header>
      <div className="setup-summary">
        <h2 id="sdk-setup-review-title">Review setup</h2>
        {"note" in state && state.note ? (
          <p role="status">{state.note}</p>
        ) : null}
        <p
          role={state.kind === "failed" ? "alert" : "status"}
          aria-live="polite"
        >
          {state.kind === "failed"
            ? state.message
            : state.kind === "planning"
              ? "Checking what setup would change…"
              : shown?.summary}
        </p>
      </div>
      {shown?.refusal ? (
        <p className="setup-refusal" role="alert">
          {shown.refusal.message}
        </p>
      ) : shown && blockedSetupReason(shown) ? (
        <p className="setup-refusal" role="alert">
          {blockedSetupReason(shown)}
        </p>
      ) : null}
      {shown && (shown.changes.length > 0 || shown.conflicts.length > 0) ? (
        <ul className="setup-change-list">
          {shown.changes.map((change) => (
            <li key={`${change.kind}:${change.target}`}>
              <span aria-hidden="true">
                {change.kind === "delete"
                  ? "−"
                  : change.kind === "create" || change.kind === "record"
                    ? "+"
                    : "~"}
              </span>
              <div>
                <strong>{change.message}</strong>
              </div>
            </li>
          ))}
          {shown.conflicts.map((conflict) => (
            <li key={`conflict:${conflict.target}`}>
              <span aria-hidden="true">!</span>
              <div>
                <strong>{conflict.message}</strong>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="welcome-actions sdk-setup-actions">
        {state.kind === "failed" ? (
          <button
            className="primary-action"
            type="button"
            onClick={() => void plan()}
          >
            Try again
          </button>
        ) : adoptable && shown ? (
          <button
            className="primary-action"
            type="button"
            disabled={busy}
            onClick={() => chooseAppVersion(shown)}
          >
            Use Planner's version
          </button>
        ) : (
          <button
            className="primary-action"
            type="button"
            disabled={
              busy || !shown || (!shown.canApply && shown.status !== "current")
            }
            onClick={() => shown && void confirm(shown)}
          >
            {state.kind === "applying"
              ? "Setting up…"
              : shown?.status === "current"
                ? "Continue"
                : "Confirm"}
          </button>
        )}
        <button
          className="text-action"
          type="button"
          disabled={state.kind === "applying"}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
