import { taskInfoToSpecFields } from "@tasknotes/model/operations";
import { validateTask } from "@tasknotes/model/validation";
import { getCurrentDateString } from "@tasknotes/model/date";
import type { JsonObject } from "@mdbase-dev/connect";
import type { TaskTypeConfiguration } from "./mdbase-repository";

/** The same portable fields TaskNotes writes; the SDK maps contract roles to
 * the selected implementing type. Never mint a Planner-specific task type. */
export function taskCreationFields(
  title: string,
  id: string,
  config: TaskTypeConfiguration,
): JsonObject {
  const now = new Date().toISOString();
  const task = {
    title: title.trim(),
    status: config.defaultStatus,
    priority: config.defaultPriority,
    dateCreated: now,
    dateModified: now,
    ...(config.statuses.some(
      (status) => status.value === config.defaultStatus && status.isCompleted,
    )
      ? { completedDate: getCurrentDateString() }
      : {}),
  };
  if (!task.title) throw new Error("Give this task a title.");
  const validation = validateTask(task);
  if (!validation.valid)
    throw new Error(validation.issues.map((issue) => issue.message).join("\n"));
  if (!config.fields.title)
    throw new Error("This task type does not expose a title.");
  return Object.fromEntries(
    Object.entries({ id, ...taskInfoToSpecFields(task) }).filter(
      ([role]) => config.fields[role],
    ),
  ) as JsonObject;
}

/** Native path patterns belong to mdbase. TaskNotes runtime templates do not:
 * use a stable UUID filename in that type's declared folder, without copying
 * TaskNotes' filename/template interpreter or guessing a folder from the title. */
export function taskCreationPath(
  definition: Record<string, unknown>,
  id: string,
): string | undefined {
  const collection = definition.collection as
    { path?: { pattern?: string; folder?: string } } | undefined;
  const policy = collection?.path;
  if (policy?.pattern) return undefined;
  const folder = policy?.folder ?? "tasks"; // TaskNotes' default when the type declares no folder.
  if (typeof folder !== "string" || !folder.trim())
    throw new Error("The task type has an invalid records folder.");
  return `${folder.replace(/\/+$/, "")}/${id}.md`;
}
