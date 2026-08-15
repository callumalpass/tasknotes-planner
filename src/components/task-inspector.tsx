import { CalendarRange, GitBranch, X } from "lucide-react";
import { useMemo, useState } from "react";

import { datePart } from "../domain/gantt";
import { errorMessage } from "../data/outcome";

import type { PlannerTask, ScheduleUpdate } from "../domain/task";
import type { FormEvent } from "react";

export function TaskInspector({
  task,
  allTasks,
  onClose,
  onSave,
}: {
  task: PlannerTask;
  allTasks: readonly PlannerTask[];
  onClose(): void;
  onSave(task: PlannerTask, update: ScheduleUpdate): Promise<void>;
}) {
  const [scheduled, setScheduled] = useState(datePart(task.scheduled) ?? "");
  const [due, setDue] = useState(datePart(task.due) ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dependencies = useMemo(
    () =>
      task.blockedBy.map((dependency) => ({
        ...dependency,
        title:
          allTasks.find(
            (candidate) =>
              candidate.id === dependency.uid ||
              candidate.path === dependency.uid,
          )?.title ?? dependency.uid,
      })),
    [allTasks, task.blockedBy],
  );
  const validation =
    scheduled && due && due < scheduled
      ? "Due date must be on or after the scheduled date."
      : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (validation) return;
    setSaving(true);
    setError("");
    try {
      await onSave(task, {
        scheduled: scheduled || undefined,
        due: due || undefined,
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside aria-labelledby="inspector-title" className="task-inspector">
      <header>
        <p>Task schedule</p>
        <button
          aria-label="Close task schedule"
          type="button"
          onClick={onClose}
        >
          <X aria-hidden="true" size={19} />
        </button>
      </header>
      <div className="inspector-title">
        <span
          className={`completion-mark${task.completed ? " is-complete" : ""}`}
        />
        <div>
          <h2 id="inspector-title">{task.title}</h2>
          <p>
            {task.status} · {task.priority} priority
          </p>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <div className="inspector-section-title">
          <CalendarRange aria-hidden="true" size={16} />
          <span>Dates</span>
        </div>
        <label>
          <span>Scheduled</span>
          <input
            type="date"
            value={scheduled}
            onChange={(event) => setScheduled(event.target.value)}
          />
        </label>
        <label>
          <span>Due</span>
          <input
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </label>
        <p className="field-help">
          Two dates draw a bar. A due date on its own creates a milestone.
        </p>
        {validation || error ? (
          <p className="form-error" role="alert">
            {validation || error}
          </p>
        ) : null}
        <div className="inspector-actions">
          <button
            className="text-action"
            disabled={saving || (!scheduled && !due)}
            type="button"
            onClick={() => {
              setScheduled("");
              setDue("");
            }}
          >
            Clear dates
          </button>
          <button
            className="save-action"
            disabled={saving || Boolean(validation)}
            type="submit"
          >
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </form>
      <section className="dependency-list">
        <div className="inspector-section-title">
          <GitBranch aria-hidden="true" size={16} />
          <span>Dependencies</span>
          <small>{dependencies.length}</small>
        </div>
        {dependencies.length ? (
          <ul>
            {dependencies.map((dependency) => (
              <li key={`${dependency.uid}-${dependency.reltype}`}>
                <span>{dependency.title}</span>
                <small>{relationshipLabel(dependency.reltype)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-help">This task has no blocking tasks.</p>
        )}
      </section>
      <p className="record-path">{task.path}</p>
    </aside>
  );
}

function relationshipLabel(value: string): string {
  if (value === "STARTTOSTART") return "Start to start";
  if (value === "FINISHTOFINISH") return "Finish to finish";
  if (value === "STARTTOFINISH") return "Start to finish";
  return "Finish to start";
}
