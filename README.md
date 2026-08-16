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
During authorization, Planner can provision the shared `core-lite` TaskNotes
type pack from `@tasknotes/model`. This lets mdbase bring older collection
definitions up to the required contract digest while preserving an existing
customized task type.

Status and priority choices come from each implementing task type's
`tasknotes.task` binding, including labels, colours, ordering, defaults, and
completed/skipped semantics. Planner does not assume a fixed set of values.

## Saved Planner views

Planner discovers Obsidian Bases views with `type: tasknotesPlanner`. Selecting
one executes its standard Base filters and ordering through mdbase. Saving a
view creates or updates a source under `TaskNotes/Views/`, with the current
project, status, priority, completed-task preference, and zoom stored in the
view. TaskNotes can show the same filtered result as a compact list and hand it
off to Planner for timeline work.

## Timeline interactions

- Use the minus and plus controls to move between quarter, month, fortnight,
  week, work-week, day, hour, and quarter-hour scales. `Ctrl`/`Cmd` + wheel
  zooms around the pointer.
- Drag a task bar to move its whole schedule. Drag either end to change its
  scheduled or due date. Drag an unscheduled row into the timeline to place it.
- Focus a bar and use `Alt` + Left/Right Arrow for one-day keyboard moves. The
  resize grips support Left/Right Arrow directly.
- Drag from the small handle below either end of one bar to an end of another
  bar to create the corresponding start/finish relationship. Cycles and
  self-links are rejected.
- Select a task to edit dates, status, priority, ordered project memberships,
  dependencies, or relationship types in the inspector.

Date-only values remain all-day at intraday scales. Timestamped tasks snap by
the visible hour or 15-minute interval, and placing unscheduled work in an
intraday view creates a TaskNotes timestamp. The inspector can add, change, or
remove times; existing seconds and timezone suffixes are preserved.

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
pnpm test:e2e
```

## Deployment

Pull requests and pushes to `main` run the complete verification suite and the
desktop browser tests. A verified `main` revision deploys automatically to
`https://planner.tasknotes.dev` through the `tasknotes-planner` Cloudflare Pages
project, then runs live boundary checks against mdbase Connect.

Publish the current working tree to the isolated staging deployment with:

```sh
pnpm dlx wrangler@4.114.0 login # first use only
pnpm deploy:dev
```

This deploys only the Cloudflare `staging` branch at
`https://staging.tasknotes-planner.pages.dev`, using staging Connect and the
staging desktop connector on `127.0.0.1:28486`. It does not change production.

Production and development builds generate separate mdbase manifests. The
production declaration contains only the `planner.tasknotes.dev` callback;
local callback URLs are never deployed.

## mdbase access

The application requests full-collection authorization because mdbase saved
views are collection-level resources. Task records are still selected and
mutated only through `tasknotes.task`. Planner requests only the capabilities
it uses:

- inspect the collection contract
- apply the shared TaskNotes type pack and declared Base-source include setting
  during authorization
- query and read TaskNotes records
- watch for collection changes
- update TaskNotes records
- list and execute saved views
- read, create, and update saved-view sources

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
