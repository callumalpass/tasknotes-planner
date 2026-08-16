import { Check, Database, LoaderCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { MdbaseApplicationSessionSnapshot } from "@mdbase-dev/connect";

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
      .catch(
        (reason: unknown) => active && setError(connectionErrorMessage(reason)),
      );
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
      setError(connectionErrorMessage(reason));
    } finally {
      setOpening(false);
    }
  }, []);

  const applySetup = useCallback(async () => {
    setOpening(true);
    setError("");
    try {
      requireOutcome(
        await plannerSession.applyCollectionSetup({ timeoutMs: 60_000 }),
      );
    } catch (reason) {
      setError(connectionErrorMessage(reason));
    } finally {
      setOpening(false);
    }
  }, []);

  const reauthorize = useCallback(async () => {
    setOpening(true);
    setError("");
    try {
      requireOutcome(
        await plannerSession.authorize("selected", { timeoutMs: 60_000 }),
      );
    } catch (reason) {
      setError(connectionErrorMessage(reason));
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

  const isWaiting =
    snapshot.status === "opening" || snapshot.status === "checking_setup";

  return (
    <main
      className={`welcome${snapshot.status === "setup_review_required" ? " setup-welcome" : ""}`}
    >
      <section className="welcome-intro">
        <div className="brand-lockup">
          <img alt="" src="/tasknotes-mark.svg" />
          <span>TaskNotes Planner</span>
        </div>
        {snapshot.status === "setup_review_required" ? (
          <>
            <h1>Finish opening this collection.</h1>
            <p className="welcome-lede">
              Review the TaskNotes files and settings Planner needs, then apply
              them to continue.
            </p>
          </>
        ) : (
          <>
            <h1>Plan tasks on a timeline.</h1>
            <p className="welcome-lede">
              Open a TaskNotes collection to change dates and manage
              dependencies.
            </p>
          </>
        )}
        <div className="welcome-actions">
          {snapshot.status === "setup_review_required" ? (
            <button
              className="primary-action"
              disabled={opening || !snapshot.update.canApply}
              type="button"
              onClick={() => void applySetup()}
            >
              {opening ? (
                <LoaderCircle aria-hidden="true" className="spin" size={18} />
              ) : (
                <Check aria-hidden="true" size={18} />
              )}
              {opening ? "Applying setup…" : "Apply setup and open"}
            </button>
          ) : snapshot.status === "authorization_required" ? (
            <button
              className="primary-action"
              disabled={opening}
              type="button"
              onClick={() => void reauthorize()}
            >
              {opening ? (
                <LoaderCircle aria-hidden="true" className="spin" size={18} />
              ) : (
                <Database aria-hidden="true" size={18} />
              )}
              {opening ? "Opening…" : "Review access"}
            </button>
          ) : (
            <button
              className="primary-action"
              disabled={opening || isWaiting}
              type="button"
              onClick={() => void authorize()}
            >
              {opening || isWaiting ? (
                <LoaderCircle aria-hidden="true" className="spin" size={18} />
              ) : (
                <Database aria-hidden="true" size={18} />
              )}
              {opening
                ? "Opening…"
                : snapshot.status === "checking_setup"
                  ? "Checking setup…"
                  : snapshot.status === "opening"
                    ? "Loading…"
                    : "Open collection"}
            </button>
          )}
          <button className="text-action" type="button" onClick={onDemo}>
            Use sample tasks
          </button>
          {snapshot.status === "setup_review_required" ? (
            <button
              className="text-action"
              disabled={opening}
              type="button"
              onClick={() => void authorize()}
            >
              Choose another collection
            </button>
          ) : null}
        </div>
        {error || stateError ? (
          <p className="error-notice" role="alert">
            {error || stateError}
          </p>
        ) : null}
      </section>
      {snapshot.status === "setup_review_required" ? (
        <SetupReview snapshot={snapshot} />
      ) : (
        <WelcomePreview />
      )}
    </main>
  );
}

type SetupReviewSnapshot = Extract<
  MdbaseApplicationSessionSnapshot,
  { status: "setup_review_required" }
>;

export function SetupReview({ snapshot }: { snapshot: SetupReviewSnapshot }) {
  const changes = snapshot.update.configuration.filter(
    (item) => item.action !== "current",
  );

  return (
    <section aria-labelledby="setup-review-title" className="setup-review">
      <header>
        <span>COLLECTION SETUP</span>
        <strong>{snapshot.info.displayName}</strong>
      </header>
      <div className="setup-summary">
        <h2 id="setup-review-title">Changes to apply</h2>
        <p>
          Task records, custom types, and unrelated collection settings will
          stay as they are.
        </p>
      </div>
      <ul className="setup-change-list">
        {snapshot.update.typePacks.map((pack) => (
          <li key={pack.id}>
            <span aria-hidden="true">+</span>
            <div>
              <strong>{pack.name}</strong>
              <small>
                {pack.currentVersion
                  ? `${pack.currentVersion} → ${pack.desiredVersion}`
                  : `Install ${pack.desiredVersion}`}
              </small>
            </div>
          </li>
        ))}
        {changes.map((item) => (
          <li key={item.requirement}>
            <span aria-hidden="true">
              {item.action === "conflict" ? "!" : "+"}
            </span>
            <div>
              <strong>
                {item.action === "conflict"
                  ? "Collection setting needs attention"
                  : "Allow TaskNotes Base views"}
              </strong>
              <small>
                {item.action === "conflict"
                  ? item.conflict?.message
                  : String(item.value)}
              </small>
            </div>
          </li>
        ))}
      </ul>
      {!snapshot.update.canApply ? (
        <p className="setup-conflict" role="alert">
          {snapshot.update.reason}
        </p>
      ) : null}
    </section>
  );
}

const previewTasks = [
  { label: "Research", start: 5, width: 26 },
  { label: "Prototype", start: 18, width: 24 },
  { label: "Review", start: 30, width: 22 },
  { label: "Release", start: 43, width: 20 },
] as const;

type PreviewDrag = {
  index: number;
  pointerId: number;
  startClientX: number;
  startOffset: number;
  trackWidth: number;
};

export function WelcomePreview() {
  const [starts, setStarts] = useState<number[]>(() =>
    previewTasks.map((task) => task.start),
  );
  const drag = useRef<PreviewDrag | null>(null);

  const moveTask = useCallback((index: number, nextStart: number) => {
    setStarts((current) => {
      const maximum = 100 - previewTasks[index].width;
      const clamped = Math.min(maximum, Math.max(0, nextStart));
      if (clamped === current[index]) return current;
      return current.map((start, taskIndex) =>
        taskIndex === index ? clamped : start,
      );
    });
  }, []);

  const startDrag = useCallback(
    (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
      const track = event.currentTarget.parentElement;
      if (!track) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = {
        index,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startOffset: starts[index],
        trackWidth: track.getBoundingClientRect().width,
      };
    },
    [starts],
  );

  const continueDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const delta =
        ((event.clientX - active.startClientX) / active.trackWidth) * 100;
      moveTask(active.index, active.startOffset + delta);
    },
    [moveTask],
  );

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      drag.current = null;
    },
    [],
  );

  const moveWithKeyboard = useCallback(
    (index: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      moveTask(index, starts[index] + direction * (event.shiftKey ? 5 : 2));
    },
    [moveTask, starts],
  );

  return (
    <div
      aria-label="Example timeline. Drag tasks to change their dates."
      className="welcome-preview"
      role="group"
    >
      <div className="preview-topline">
        <span>LAUNCH PLAN</span>
        <span>AUG — SEP</span>
      </div>
      {previewTasks.map((task, index) => (
        <div className="preview-row" key={task.label}>
          <span>{task.label}</span>
          <div className="preview-track">
            <button
              aria-label={`${task.label}: move task`}
              className="preview-task"
              style={
                {
                  "--preview-start": starts[index],
                  "--preview-width": task.width,
                } as CSSProperties
              }
              title="Drag to move task"
              type="button"
              onKeyDown={(event) => moveWithKeyboard(index, event)}
              onPointerCancel={finishDrag}
              onPointerDown={(event) => startDrag(index, event)}
              onPointerMove={continueDrag}
              onPointerUp={finishDrag}
            />
          </div>
        </div>
      ))}
      <b className="preview-today">TODAY</b>
    </div>
  );
}

function connectionErrorMessage(reason: unknown): string {
  const message = errorMessage(reason);
  if (/unknown application or redirect uri/i.test(message))
    return "This Planner address is not registered. Open Planner from its main URL and try again.";
  return message;
}

function unavailableMessage(reason: string): string {
  if (reason === "authorization_lost")
    return "The collection authorization is no longer available.";
  if (reason === "invalid_stored_grant")
    return "The saved collection connection is no longer valid.";
  return "This collection needs to be authorized again.";
}
