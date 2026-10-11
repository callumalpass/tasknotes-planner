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

## Planned SDK application entry

The integration target is one public SDK entry: declare the application, obtain
its lifecycle session, authorize in a user gesture, select a collection, and use
its current scoped connection for records, files and people. This entry is still
being implemented; the development archive provides its public types and an
explicitly unavailable runtime shell, not the complete composition.
TaskNotes is the first consumer and Planner follows after qualified delivery.

Planner supplies only its declaration: identity, name, origin/environment and
manifest. The SDK owns authenticated native assets/trust, Worker and SQL plumbing,
DB names, setup journal, current semantic/catalog readiness, original recovery
and the existing people directory engine. New namespaces are SDK-derived from
registered app identity. Optional storage compatibility is declaration data for
existing installations, not an app-owned engine or permission to replace them.
Planner has no original native journal requiring a compatibility override.

`dev.tasknotes.planner` is manifest identity, not evidence of a registered native
application UUID. The typed registration binding must be settled before database
allocation; prototype UUIDs or namespace strings cannot stand in for registration.
The scoped records service must retain the same public borrowed `MdbaseClient`
used by `NextPlannerRepository` and `NextPlannerViews`, including receipts,
watches and native AppBases/source APIs. Accessors do not add consent: Planner's
manifest omits files and people. Only the canonical shared manifest compiler may
interpret authorization; no duplicate compiler or implicit widening is supplied.

The local per-app loader/factory/inventory prototypes are frozen, source-only
experiments, not an integration recipe. Do not copy them into another app or the
SDK. Native open/readiness/recovery requires qualified delivery and genuine local
acceptance, independently of source tests or archive qualification.

## Public-entry source port

The port branch targets the public application types landed at SDK source
`e519009a1b1838b987e7afa8c77cd49c1687d6a5`. `createPlannerApplication`
supplies only the unchanged manifest, name, origin, environment and a caller's
actual registered application ID; no prototype UUID or storage override is used.
`App` accepts that SDK entry optionally. Native mode does not import or instantiate
the legacy session; the default entry still uses the existing Connect runtime.

The existing ledger receives `NextPlannerRepository` over the selected
connection's **same borrowed client**, only when the SDK reports current semantic
readiness and a current selected connection. UI teardown releases repository
watches/scope, never the SDK client. Collection changes await SDK selection
clearing and show close refusals without discarding the current ledger. Sign-out
waits for successful physical close; late actions from retired UI owners cannot
publish sign-out for a replacement owner. Identity uses the SDK's existing
canonical email or GitHub provider/login fields, never an account UUID or a
fabricated email.

The public entry currently has an explicitly unavailable runtime shell. Registered
binding, popup reopen/expiry helpers, explicit SDK
configuration/provisioning and a public lifecycle testing seam remain producer
work. `setup_required` stays visible; there is no app setup engine or synthetic
READY. Old local data and pending writes need no cutover handoff for any app;
ongoing new-SDK recovery remains mandatory.

The original development intake at `e519009a` is installed through normal file
dependencies on both its SDK archive and the unchanged canonical protocol718
archive. The protocol tar must also be in the consumer's `vendor/` directory;
its transitive file path is consumer-relative. There are no aliases, API casts,
private source copies or package rewrites. This intake permits source typechecking,
not release or native qualification. UI lifecycle stand-ins and MemoryReplica
rendering tests do not qualify runtime, native initialization, registration or
end-to-end operation. No deployment or LAB pin change is enabled.

## Artifact and checks

The SDK tarball and its source commit/SHA256 are recorded in
`vendor/mdbase-next-sdk.json`. It is supplied by the release workstream, not npm.
The current pin is the **development intake, not release-qualified**, from exact
SDK source `e519009a1b1838b987e7afa8c77cd49c1687d6a5`: original 889027-byte
SDK archive, 318 safe regular members, SHA256
`659b5eb73dd9839d2184af37caf93ac6235d105f99436efedc59f6f01f5276c5`.
The original protocol718 beta129 archive is 70658 bytes with SHA256
`dfc5db0daf6700874aa2c6235b86570f1d4e444740d0925bf1f97551cf43d3bd`.
Original hashes/member layout and SDK/protocol bytes were independently checked.
Neither the public unavailable shell nor this dependency change enables native
sign-in, READY, deployment or a change to the held LAB SDK.

The previous original release-qualified `b9965703` archive is retained, including SDK837's
host/caller lifetime composition fix and SDK832's optional bounded
`problemDetail`, plus the earlier public factory and provider-receipt helpers.
Release qualified all 278 archive members, 1678 SDK tests and five browser-bundle
checks (with three existing WASM-gated skips); the original 750928-byte archive
is retained unchanged. Planner consumes SDK snapshots directly and does not
introduce a diagnostic parser, raw-error logging or retry authority. This pin
activates no new factory or per-app native composition.
The new entry source port does not change Planner's native read/write implementation.
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

The existing source-only `createNativeSignIn(options)` binding uses the pinned
SDK's actual `AppWebSignInSession`. Its lower-level explicit release, identity,
origin, runtime, locks and signal inputs support conformance checks, not the
planned app integration. They will move behind the shared application entry;
apps must not add new runtime, Worker, SQL or setup glue to complete this binding.
The existing screen accepts its binding and an `onSignedOut` callback through
`ConnectionGate`'s optional `nativeSignIn` prop. The owner closes the borrowed SDK
session on teardown and creates a fresh instance only after confirmed close or
explicit sign-in.

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
promise is displayed without its real capability. A generic SDK refusal does
not prove a user decline, so the UI does not invent that state.

Focused presentation and React forwarding tests use labelled SDK stand-ins, not
native sign-in/LAB qualification. The public application entry, authenticated SDK
asset delivery, registered identity and current setup/people composition remain
required before a native runnable URL exists. The future entry must retain this
screen's popup, selection and lifetime behavior without per-app infrastructure.
