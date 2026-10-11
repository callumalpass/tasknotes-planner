import { useCallback, useEffect, useRef, useState } from "react";
import {
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
  "This collection changed while you were reviewing. Here are the updated changes.";

/** One review before setup: the SDK's plan summary and plain per-change
 * messages, then Confirm applies exactly that plan. Nothing is written
 * until Confirm. A changed collection is planned again for a fresh review. */
export function SdkSetupReview({
  application,
  displayName,
  onCancel,
  onApplied,
}: {
  application: Pick<MdbaseApplication, "setup">;
  displayName: string;
  onCancel(): void;
  onApplied?(): void;
}) {
  const [state, setState] = useState<State>({ kind: "planning" });
  const adopt = useRef<Readonly<Record<string, string>> | undefined>(undefined);
  const scope = useRef<AbortController | null>(null);

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
        if (!signal.aborted) setState({ kind: "review", plan: next, note });
      } catch {
        if (!signal.aborted)
          setState({
            kind: "failed",
            message: "Planner couldn't check what setup would change.",
          });
      }
    },
    [application],
  );

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    queueMicrotask(() => void plan());
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
      if (isMdbaseError(error) && error.reason === "setup_changed")
        return void plan(changedNote);
      setState({
        kind: "failed",
        message: "Setup didn't finish. Nothing was changed.",
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
