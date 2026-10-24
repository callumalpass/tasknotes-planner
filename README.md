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
During authorization, Planner provisions the canonical TaskNotes type pack
published by `mdbase-contracts` and pinned in `vendor/mdbase-contracts`. This lets mdbase bring older collection
definitions up to the required contract digest while preserving an existing
customized task type.

Run `pnpm contracts:sync` after intentionally updating the pinned catalog URL
and digest to refresh the vendored pack from `mdbase.dev`.

Status and priority choices come from each implementing task type's
`tasknotes.task` binding, including labels, colours, ordering, defaults, and
completed/skipped semantics. Planner does not assume a fixed set of values.

## Saved Planner views

Planner discovers Obsidian Bases views with `type: tasknotesPlanner`. Selecting
one executes its standard Base filters and ordering through mdbase. Saving a
view creates or updates a source under `TaskNotes/Views/`, with the current
project, status, priority, completed-task preference, and zoom stored in the
view. The normal collection setup declares `md` and `base` in
`settings.record_extensions`, preserving Markdown and existing extensions: the
canonical `obsidian.base` type requires YAML document records, not opaque files.
TaskNotes can show the same filtered result as a compact list and hand it
off to Planner for timeline work.

## Timeline interactions

Use **Add task** in the header, or **Add your first task** in an empty
collection. Planner creates a portable TaskNotes task through the collection's
implementing `tasknotes.task` type, using its default status and priority. The
new task is shared with TaskNotes, not a separate Planner task copy. Set its
schedule and other planning properties in the inspector after adding it.

An empty collection shows **No tasks yet**. If a saved view or the current
filters hide tasks, Planner instead prompts you to change the view or filters.
A secondary TaskNotes link opens the same collection in the matching LAB,
staging, or production app; TaskNotes still owns its own sign-in and approval.

- Use the minus and plus controls to move between quarter, month, fortnight,
  week, work-week, day, hour, and quarter-hour scales. `Ctrl`/`Cmd` + wheel
  zooms around the pointer.
- Drag a task bar to move its whole schedule. Drag either end to change its
  scheduled or due date. Drag an unscheduled row into the timeline to place it.
- Focus a bar and use `Alt` + Left/Right Arrow for one-day keyboard moves, or
  `Alt` + `Shift` + Left/Right Arrow to change its end.
- Drag from the handle at the end of one bar onto another bar to make the
  second task blocked by the first (finish-to-start). Set other relationship
  types in the inspector. Cycles and self-links are rejected.
- On touch screens, press and hold a bar or an unscheduled title before
  dragging it.
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
sample plan, or remove `?demo=1` to connect an mdbase collection. The sample
collection is labelled **Sample tasks**; its changes reset when you leave or
reload. Choose its collection name to return to the connection screen. Leaving
the sample also removes its URL flag, so reload does not reopen it. Use
`127.0.0.1`, not the `localhost` alias: the manifest and callback share this
single development origin.

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
mutated only through `tasknotes.task`. Planner declares capability contract v2
with required atomic groups `collection.read`, `records.create`, `records.edit`, `views.manage`,
and `definitions.manage` for these workflows:

- inspect the collection contract
- apply the shared TaskNotes type pack and declared Base-source include setting
  during authorization
- query and read TaskNotes records
- watch for collection changes
- create and update TaskNotes records
- list and execute saved views
- read, create, and update saved-view sources

Atomic consent also grants record validation/rename, type reading/creation, and
saved-view source deletion. Saved-view deletion is not record deletion, and no
independent operation permission is requested. Task creation also requires the
`add` file action; an older approval without it needs renewed consent. Record
deletion, arbitrary file operations, offline replicas, and background scheduling
remain excluded. See
[the migration guard and rollout order](docs/capability-v2-migration.md): the
vendored beta96 v2 candidate SDK is source-bound development evidence, not a published or
signed release. This v2 draft must not deploy before the qualified v2 writer.

The production declaration assumes `https://planner.tasknotes.dev/`. Update the
homepage, icon, and redirect URI together if the deployment origin changes.

## New SDK migration

The existing Connect session remains the default. A native SDK data adapter is
being prepared separately; it is not yet a browser sign-in mode. See
[its behavior, pinned artifact, and remaining dependencies](docs/new-sdk.md).

## Repository structure

```text
src/components   React application and Gantt surface
src/data         mdbase connection and repository adapters
src/domain       task and timeline semantics
public           web and mdbase application manifests
vendor           pinned TaskNotes model and mdbase Connect packages
```
