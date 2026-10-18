import { useRef, useState, type FormEvent } from "react";
import type { PlannerRepository, PlannerTask } from "../domain/task";
import { errorMessage, isOperationOutcomeUnknown } from "../data/outcome";
import { useModalFocus } from "./use-modal-focus";

/** One form draft is one creation intent, including a retry after a lost reply. */
export function TaskCreateDialog({
  open,
  disabled,
  repository,
  onClose,
  onCreated,
  onSettled,
}: {
  open: boolean;
  disabled: boolean;
  repository: PlannerRepository;
  onClose(): void;
  onCreated(task: PlannerTask): void;
  onSettled(): void;
}) {
  const [draft, setDraft] = useState(() => ({
    title: "",
    intent: crypto.randomUUID(),
  }));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const unknown = failure !== null && isOperationOutcomeUnknown(failure);
  function close() {
    if (pending.current) return;
    // An uncertain write is not a cancelled write. Reopening retains its identity.
    if (!unknown) {
      setDraft({ title: "", intent: crypto.randomUUID() });
      setFailure(null);
    }
    onClose();
  }
  useModalFocus(open, form, close);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || disabled || !draft.title.trim()) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const task = await repository.createTask(draft.title, draft.intent);
      setDraft({ title: "", intent: crypto.randomUUID() });
      onClose();
      onCreated(task);
    } catch (reason) {
      setFailure(reason);
    } finally {
      pending.current = false;
      setBusy(false);
      onSettled();
    }
  }

  if (!open) return null;
  return (
    <div className="planner-dialog-backdrop" role="presentation">
      <form
        ref={form}
        className="planner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-task-title"
        onSubmit={(event) => void submit(event)}
      >
        <div className="planner-dialog-heading">
          <h2 id="add-task-title">Add task</h2>
        </div>
        <label>
          Task title
          <input
            autoComplete="off"
            required
            value={draft.title}
            readOnly={busy || unknown}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </label>
        {failure !== null ? (
          <p className="planner-error" role="alert">
            {errorMessage(failure)}
            {unknown
              ? " Retry uses this same task creation; do not add a second copy."
              : ""}
          </p>
        ) : null}
        <div className="planner-dialog-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={busy || disabled || !draft.title.trim()}
          >
            {busy ? "Adding…" : "Add task"}
          </button>
        </div>
      </form>
    </div>
  );
}
