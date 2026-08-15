# TaskNotes Planner

A focused Gantt web app for collections that provide the portable
`tasknotes.task` mdbase contract. It is an independent product from TaskNotes:
TaskNotes remains the fast daily task surface, while Planner is designed for
wide-screen sequencing and schedule review.

## Planning semantics

- `scheduled` is the start of a task bar.
- `due` is the inclusive end of a task bar.
- A task with only `due` is a milestone.
- A task without either date remains visible as unscheduled work.
- `blockedBy` draws dependency connectors using the relationship type stored by
  TaskNotes.
- The first `projects` value determines the visible project group. Filtering by
  a project still matches every project attached to a task.
- `timeEstimate` remains effort and is deliberately not treated as elapsed Gantt
  duration.

Planner reads and updates these values through the canonical TaskNotes contract;
it does not depend on TaskNotes' application source or a second local task copy.

## Development

```sh
pnpm install
pnpm dev
```

Open [http://127.0.0.1:4174/?demo=1](http://127.0.0.1:4174/?demo=1) for the
sample plan, or remove `?demo=1` to connect an mdbase collection.

Useful checks:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify
```

## mdbase access

The application requests contract-scoped access to `tasknotes.task` and only
the capabilities it uses:

- inspect the collection contract
- query and read TaskNotes records
- watch for collection changes
- update TaskNotes records

The production declaration assumes `https://planner.tasknotes.dev/`. Update the
homepage, icon, and redirect URI together if the deployment origin changes.

## Repository structure

```text
src/components   React application and Gantt surface
src/data         mdbase connection and repository adapters
src/domain       task and timeline semantics
public           web and mdbase application manifests
vendor           pinned TaskNotes model and mdbase Connect packages
```
