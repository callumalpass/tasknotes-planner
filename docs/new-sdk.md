# New SDK data adapter

`NextPlannerRepository` implements `PlannerRepository` directly on the pinned
`@mdbase-dev/sdk` package. The existing Connect session remains the application
default. There is **no working new-SDK browser sign-in switch in this change**;
this data adapter is a foundation for the shared SDK web sign-in integration.
The opt-in SDK sign-in UI below does not change the default runtime.
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
  Live recovery applies the original portable identity/provider witness as well
  as the native UUID/state checks. Restored intents do not invent lost witnesses.
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
selected declarations, including anchors anywhere in the selected subtree,
are refused before capture rather than risking shared-node sibling changes.
View writability uses the supplied role/capability and current native source
state; create/edit preflight refuses unsupported grants before minting an intent
or calling the source helper. Native enforcement remains authoritative.
Serialization can
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
The pin is the release-qualified successor at `9ab0f31d`, including SDK816's explicit environment
selection, SDK808's
session fix, SDK809 leases, SDK811's fixture fix and SDK814's shared read helpers.
This pin-only update does not change Planner's existing read/write implementation.
Archive SHA256/SHA512 were verified. This is source/package qualification, not
per-app trust/origin/runtime/session/operation acceptance or a published release.
The earlier SDK807 `5ba1314b` archive remains held and must not be reused; no
browser/session path is enabled by this dependency update.

Unit tests use the SDK's MemoryReplica for record/receipt frames, with synthetic
native contract metadata and mocked AppBases results. SDK811's shared synthetic
parser now handles `create.document`; the source-create test no longer installs
an app-side fixture bridge and still asserts the exact document submission. These tests are not LAB, native renderer,
source-parser, sign-in, or end-to-end evidence. Run `pnpm verify` and
`pnpm test:e2e` for the existing application checks.

## Public SDK sign-in UI

`createNativeSignIn(options)` uses the pinned SDK's actual `AppWebSignInSession`.
All release, app identity, origin, runtime, locks and original signal inputs must
be supplied explicitly by the app owner; no guessed build configuration is used.
Pass its binding and an `onSignedOut` callback through `ConnectionGate`'s optional
`nativeSignIn` prop. The owner closes the borrowed SDK session on teardown and
creates a fresh SDK instance only after confirmed close or explicit sign-in.

The UI reserves a named 620×760 Connect popup synchronously before SDK
start/expiry renewal, using the same app-owned pattern as TaskNotes. The trusted
Connect popup keeps its opener for parent-owned cross-origin closure; the tab
fallback detaches its opener before navigation (noopener semantics). No secrets,
postMessage approval callback or storage callback use the opener. The SDK
supplies the validated navigation URI and detects approval. The UI retains its
original handle after handoff and closes it on completed or terminal public SDK
statuses, never while authorizing additional consent, even if already paired.
Only the owned popup is cleaned up on view teardown, not the borrowed session.
A detached fallback tab is not claimed parent-closeable after crossing origins.
It renders actual
SDK status/email, tab reopening, blocked-popup and interrupted states. Local
**Sign out** waits for SDK `close()`; it neither revokes membership nor erases
protected sign-in stores. **Forget collection** calls the SDK's selected-ID
`forget` action. Failed or retired actions cannot publish another owner's state.

The collection callback explicitly refuses with
**Opening collections isn't available in this build yet.** It does not return a
fake connection, setup result or saved state. No setup, offline-sync or reminder
promise is displayed without its real capability. SDK9ab cannot distinguish a
user decline from every generic refusal, so the UI does not invent that state.

Focused presentation and React forwarding tests use labelled SDK stand-ins, not
native sign-in/LAB qualification. Authenticated build inputs and qualified shared
factory/setup composition remain required before a native runnable URL exists.
