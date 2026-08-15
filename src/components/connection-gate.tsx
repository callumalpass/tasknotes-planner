import { ArrowRight, Database, LoaderCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { CSSProperties } from "react";

import { isAuthorizationCallback, plannerSession } from "../data/connect";
import { MdbasePlannerRepository } from "../data/mdbase-repository";
import { errorMessage, requireOutcome } from "../data/outcome";
import { Planner } from "./planner";

export function ConnectionGate({ onDemo }: { onDemo(): void }) {
  const snapshot = useSyncExternalStore(
    (listener) => plannerSession.subscribe(listener),
    () => plannerSession.getSnapshot(),
    () => plannerSession.getSnapshot(),
  );
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const handledCallback = useRef(false);

  useEffect(() => {
    let active = true;
    void plannerSession
      .start({ timeoutMs: 20_000 })
      .then(requireOutcome)
      .then(async () => {
        if (
          active &&
          !handledCallback.current &&
          isAuthorizationCallback(location.href)
        ) {
          handledCallback.current = true;
          requireOutcome(
            await plannerSession.handleAuthorizationCallback(location.href, {
              timeoutMs: 60_000,
            }),
          );
        }
      })
      .catch((reason: unknown) => active && setError(errorMessage(reason)));
    return () => {
      active = false;
    };
  }, []);

  const connection =
    snapshot.status === "ready" ? plannerSession.connection() : null;
  const repository = useMemo(
    () => (connection ? new MdbasePlannerRepository(connection) : null),
    [connection],
  );

  const authorize = useCallback(async () => {
    setOpening(true);
    setError("");
    try {
      requireOutcome(
        await plannerSession.authorize("choose", { timeoutMs: 60_000 }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setOpening(false);
    }
  }, []);

  if (repository)
    return (
      <Planner
        repository={repository}
        onChangeCollection={() => plannerSession.clearSelection()}
      />
    );

  const stateError =
    snapshot.status === "blocked"
      ? snapshot.problem.message
      : snapshot.status === "unavailable"
        ? unavailableMessage(snapshot.reason)
        : "";

  return (
    <main className="welcome">
      <section className="welcome-intro">
        <div className="brand-lockup">
          <img alt="" src="/tasknotes-mark.svg" />
          <span>TaskNotes Planner</span>
        </div>
        <p className="eyebrow">A connected planning surface</p>
        <h1>See the work across time.</h1>
        <p className="welcome-lede">
          Open a TaskNotes collection to arrange scheduled work, inspect
          dependencies, and bring the next handoff into view.
        </p>
        <div className="welcome-actions">
          <button
            className="primary-action"
            disabled={opening}
            type="button"
            onClick={() => void authorize()}
          >
            {opening ? (
              <LoaderCircle aria-hidden="true" className="spin" size={18} />
            ) : (
              <Database aria-hidden="true" size={18} />
            )}
            {opening ? "Opening mdbase…" : "Open a collection"}
          </button>
          <button className="text-action" type="button" onClick={onDemo}>
            Explore with sample tasks
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
        {error || stateError ? (
          <p className="error-notice" role="alert">
            {error || stateError}
          </p>
        ) : null}
      </section>
      <WelcomePreview />
    </main>
  );
}

function WelcomePreview() {
  return (
    <div className="welcome-preview" aria-hidden="true">
      <div className="preview-topline">
        <span>LAUNCH PLAN</span>
        <span>AUG — SEP</span>
      </div>
      {["Research", "Prototype", "Review", "Release"].map((label, index) => (
        <div className="preview-row" key={label}>
          <span>{label}</span>
          <i
            style={
              {
                "--preview-start": index * 11,
                "--preview-width": 26 - index * 2,
              } as CSSProperties
            }
          />
        </div>
      ))}
      <b className="preview-today">TODAY</b>
    </div>
  );
}

function unavailableMessage(reason: string): string {
  if (reason === "authorization_lost")
    return "The collection authorization is no longer available.";
  if (reason === "invalid_stored_grant")
    return "The saved collection connection is no longer valid.";
  return "This collection needs to be authorized again.";
}
