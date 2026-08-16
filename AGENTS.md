# TaskNotes Planner

Read `README.md` and `DESIGN.md` before changing user-facing behavior or visuals.

The app consumes the portable `tasknotes.task` contract directly through
`@mdbase-dev/connect`. Record access must remain contract-scoped even though
the app uses full-collection authorization for the saved-view APIs required by
`tasknotesPlanner` Bases. Do not import source code from the TaskNotes
application repository. Date, dependency, and field behavior that belongs to
the portable model should remain in `@tasknotes/model` rather than being
reimplemented here.

Treat `scheduled` as a bar start, `due` as its inclusive end, and due-only tasks
as milestones. Do not derive elapsed duration from `timeEstimate`, which is an
effort estimate.
