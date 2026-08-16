import { Database, LoaderCircle } from "lucide-react";
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
        <h1>Plan tasks on a timeline.</h1>
        <p className="welcome-lede">
          Open a TaskNotes collection to change dates and manage dependencies.
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
            {opening ? "Opening…" : "Open collection"}
          </button>
          <button className="text-action" type="button" onClick={onDemo}>
            Use sample tasks
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
