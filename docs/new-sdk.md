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
- Unconfirmed/unknown outcomes and ambiguous internal SDK response errors remain
  visible through the existing pending mutation port. Task writes retain their
  original native target until confirmed, unprotected current readback succeeds;
  a receipt alone cannot publish another consumer's pending edit as saved.
  Recovery looks up the **same mutation**, never resubmits a new edit.
  Protected/conflicted tasks must be resolved in TaskNotes.
- The change subscription is established before loading a snapshot. Repository
  disposal aborts outstanding work and closes the watch, not the session-owned
  SDK client.

## Saved views and dependencies

`NextPlannerViews` uses only the public native AppBases discovery, source-read,
and execution methods. It carries native record UUID, source SHA and original
ordinal unchanged. Options come from that exact source; filtering and ordering
remain native. Row metadata is read in bounded parallel batches and checked
against the native row revisions. There is no generic saved-view RPC fallback.

The generic renderer change in mdbase-next PR #802 is merged, but its native
runtime/trust still needs qualification and delivery. Native refusal remains an
error, not an empty catalog or an all-tasks fallback.

Saved-view writes use the shared SDK #804 `views.createSource`,
`views.updateSource`, and `views.getSourceRecord` APIs. Updates require the actual
full source at the selected UUID/path/revision, and change Planner-owned fields
at the original ordinal. Root metadata, siblings, renderer aliases and unknown
options are retained through the YAML document model; unsupported/aliased
selected declarations are refused rather than overwritten. Serialization can
change YAML formatting. New sources use a separate captured record UUID under
`TaskNotes/Views/`, not a name-based overwrite.

Original native mutation IDs remain visible for receipt/readback-only recovery.
Saved results require actual confirmation, unprotected current full-source
readback, and native discovery of the same UUID/source revision/original ordinal.
Restored source intents qualify their actual complete source without inventing
lost ordinal metadata. View and task writes share the repository's pending-write
boundary; no separate autosave/session engine is introduced.

Shared web sign-in and manifest-driven setup must be integrated from the SDK;
Planner does not implement private auth/route/grant protocols or a second setup
engine. The application will not switch its data path until those dependencies
are available and tested.

## Artifact and checks

The SDK tarball and its source commit/SHA256 are recorded in
`vendor/mdbase-next-sdk.json`. It is supplied by the release workstream, not npm.
The data-only pin is the release-qualified SDK #804 source archive at
`d43204b6`; it contains no #807 browser bundle or #803 web sign-in session.
It contains neither a qualified native Files producer nor a published release
claim. The later SDK #807 archive is under a sign-in safety hold and must not be
used to enable the browser/session path.

Unit tests use the SDK's MemoryReplica for record/receipt frames, with synthetic
native contract metadata and mocked AppBases results. Its `create.document`
parser omission is explicitly bridged in the source-create test while asserting
the exact document submission. These tests are not LAB, native renderer,
source-parser, sign-in, or end-to-end evidence. Run `pnpm verify` and
`pnpm test:e2e` for the existing application checks.
