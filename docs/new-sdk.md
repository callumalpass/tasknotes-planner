# New SDK data adapter

`NextPlannerRepository` implements `PlannerRepository` directly on the pinned
`@mdbase-dev/sdk` package. The existing Connect session remains the application
default. There is **no working new-SDK browser sign-in switch in this change**;
this data adapter is a foundation for the shared SDK web sign-in integration.
Do not use it as evidence of launch readiness or a deployed app.

## Data behavior

- Requires the exact portable `tasknotes.task` version and digest from the native
  catalog. Only implementing types are queried; canonical fields are mapped to
  each provider's actual field names. No default task-type fallback exists.
- Reads effective metadata without task bodies. Incomplete query results and
  duplicate portable task IDs are refused rather than published as a complete
  plan. Nested field-reference bindings are explicitly unsupported until the
  shared SDK provides nested updates.
- Reads the current task before editing, checks its portable identity and type,
  applies explicit CAS, waits for a receipt, and reads the confirmed record back.
  Portable completion and dependency behavior still comes from `@tasknotes/model`.
- Unconfirmed and unknown outcomes remain visible through the existing pending
  mutation port. Recovery looks up the **same mutation**, never resubmits a new
  edit. Protected/conflicted tasks must be resolved in TaskNotes.
- The change subscription is established before loading a snapshot. Repository
  disposal aborts outstanding work and closes the watch, not the session-owned
  SDK client.

## Saved views and dependencies

`NextPlannerViews` uses only the public native AppBases discovery, source-read,
and execution methods. It carries native record UUID, source SHA and original
ordinal unchanged. Options come from that exact source; filtering and ordering
remain native. Row metadata is read in bounded parallel batches and checked
against the native row revisions. There is no generic saved-view RPC fallback.

The currently pinned runtime does not yet admit arbitrary `tasknotesPlanner`
renderers. This needs the generic Bases change in mdbase-next PR #802 and a new
release-qualified runtime/SDK. Native refusal remains an error, not an empty
catalog or an all-tasks fallback.

Saving views is explicitly unavailable pending the shared SDK `views.createSource`,
`views.updateSource`, and `views.getSourceRecord` APIs. The native adapter marks
sources read-only and refuses writes rather than creating ad hoc records.

Shared web sign-in and manifest-driven setup must be integrated from the SDK;
Planner does not implement private auth/route/grant protocols or a second setup
engine. The application will not switch its data path until those dependencies
are available and tested.

## Artifact and checks

The SDK tarball and its source commit/SHA256 are recorded in
`vendor/mdbase-next-sdk.json`. It is supplied by the release workstream, not npm.
It contains neither the unmerged Files API nor a published release claim.

Unit tests use the SDK's MemoryReplica for record/receipt frames, with synthetic
native contract metadata and mocked AppBases results. They are not LAB, native
renderer, sign-in, or end-to-end evidence. Run `pnpm verify` and
`pnpm test:e2e` for the existing application checks.
