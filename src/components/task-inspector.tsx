import { CalendarRange, GitBranch, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  addOrReplaceDependency,
  canAddDependency,
  datePart,
  dependencyReferencesTask,
  replaceDatePart,
  resolveDependencyTask,
} from "../domain/gantt";
import { errorMessage } from "../data/outcome";

import type {
  PlannerTask,
  ScheduleUpdate,
  TaskDependency,
  TaskDependencyRelType,
} from "../domain/task";
import type { FormEvent } from "react";

export function TaskInspector({
  task,
  allTasks,
  onClose,
  onSave,
  onSaveDependencies,
}: {
  task: PlannerTask;
  allTasks: readonly PlannerTask[];
  onClose(): void;
  onSave(task: PlannerTask, update: ScheduleUpdate): Promise<void>;
  onSaveDependencies(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ): Promise<void>;
}) {
  const [scheduled, setScheduled] = useState(datePart(task.scheduled) ?? "");
  const [due, setDue] = useState(datePart(task.due) ?? "");
  const [saving, setSaving] = useState(false);
  const [dependencySaving, setDependencySaving] = useState(false);
  const [dependencySource, setDependencySource] = useState("");
  const [dependencyType, setDependencyType] =
    useState<TaskDependencyRelType>("FINISHTOSTART");
  const [scheduleError, setScheduleError] = useState("");
  const [dependencyError, setDependencyError] = useState("");

  const dependencies = useMemo(
    () =>
      task.blockedBy.map((dependency) => ({
        ...dependency,
        title:
          resolveDependencyTask(allTasks, dependency.uid)?.title ??
          dependency.uid,
      })),
    [allTasks, task.blockedBy],
  );
  const validation =
    scheduled && due && due < scheduled
      ? "Due date must be on or after the scheduled date."
      : "";
  const dependencyCandidates = useMemo(
    () =>
      allTasks.filter(
        (candidate) =>
          candidate.id !== task.id &&
          !task.blockedBy.some((dependency) =>
            dependencyReferencesTask(allTasks, dependency, candidate),
          ) &&
          canAddDependency(allTasks, candidate.id, task.id).allowed,
      ),
    [allTasks, task.blockedBy, task.id],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (validation) return;
    setSaving(true);
    setScheduleError("");
    try {
      await onSave(task, {
        scheduled: scheduled
          ? replaceDatePart(task.scheduled, scheduled)
          : undefined,
        due: due ? replaceDatePart(task.due, due) : undefined,
      });
    } catch (reason) {
      setScheduleError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveDependencies(dependencies: readonly TaskDependency[]) {
    setDependencySaving(true);
    setDependencyError("");
    try {
      await onSaveDependencies(task, dependencies);
    } catch (reason) {
      setDependencyError(errorMessage(reason));
    } finally {
      setDependencySaving(false);
    }
  }

  async function addDependency() {
    if (!dependencySource) return;
    const allowed = canAddDependency(allTasks, dependencySource, task.id);
    if (!allowed.allowed) {
      setDependencyError(allowed.reason);
      return;
    }
    await saveDependencies(
      addOrReplaceDependency(
        task.blockedBy,
        dependencySource,
        dependencyType,
        allTasks,
      ),
    );
    setDependencySource("");
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
        {validation || scheduleError ? (
          <p className="form-error" role="alert">
            {validation || scheduleError}
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
                <select
                  aria-label={`Relationship from ${dependency.title}`}
                  disabled={dependencySaving}
                  value={dependency.reltype}
                  onChange={(event) =>
                    void saveDependencies(
                      task.blockedBy.map((candidate) =>
                        candidate.uid === dependency.uid
                          ? {
                              ...candidate,
                              reltype: event.target
                                .value as TaskDependencyRelType,
                            }
                          : candidate,
                      ),
                    )
                  }
                >
                  {relationshipTypes.map((type) => (
                    <option key={type} value={type}>
                      {relationshipLabel(type)}
                    </option>
                  ))}
                </select>
                <button
                  aria-label={`Remove relationship from ${dependency.title}`}
                  disabled={dependencySaving}
                  type="button"
                  onClick={() =>
                    void saveDependencies(
                      task.blockedBy.filter(
                        (candidate) => candidate.uid !== dependency.uid,
                      ),
                    )
                  }
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-help">This task has no blocking tasks.</p>
        )}
        {dependencyCandidates.length ? (
          <div className="dependency-adder">
            <label>
              <span className="sr-only">Blocking task</span>
              <select
                value={dependencySource}
                onChange={(event) => setDependencySource(event.target.value)}
              >
                <option value="">Choose blocking task</option>
                {dependencyCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Relationship type</span>
              <select
                value={dependencyType}
                onChange={(event) =>
                  setDependencyType(event.target.value as TaskDependencyRelType)
                }
              >
                {relationshipTypes.map((type) => (
                  <option key={type} value={type}>
                    {relationshipLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="Add relationship"
              disabled={!dependencySource || dependencySaving}
              type="button"
              onClick={() => void addDependency()}
            >
              <Plus aria-hidden="true" size={16} />
            </button>
          </div>
        ) : null}
        {dependencyError ? (
          <p className="form-error" role="alert">
            {dependencyError}
          </p>
        ) : null}
      </section>
      <p className="record-path">{task.path}</p>
    </aside>
  );
}

const relationshipTypes: TaskDependencyRelType[] = [
  "FINISHTOSTART",
  "STARTTOSTART",
  "FINISHTOFINISH",
  "STARTTOFINISH",
];

function relationshipLabel(value: string): string {
  if (value === "STARTTOSTART") return "Start to start";
  if (value === "FINISHTOFINISH") return "Finish to finish";
  if (value === "STARTTOFINISH") return "Start to finish";
  return "Finish to start";
}
