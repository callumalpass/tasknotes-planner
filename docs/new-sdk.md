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
its current scoped connection for records, files and people. Since `7193fd0d`
the development archive carries the live composition (LAB environment only);
it is not release- or native-qualified.
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

The port branch targets the public application entry at SDK dev source
`1dddb04cc423d07fcccedeedb0af2de2c2c6265a`, original `sdk-dev-1dddb04c` cut (earlier pins, including distinct `sdk-dev-2e2ae687-n1`, remain in history). `createPlannerApplication`
supplies only the unchanged manifest (logical ID, name, homepage origin) and the
environment; the SDK registers the manifest and rebinds to the actual registered
ID before any storage. No prototype UUID or storage override is used. `App`
accepts that SDK entry optionally.

The existing ledger receives `NextPlannerRepository` over the selected
connection's **same borrowed client**, only when the SDK reports current semantic
readiness and a current selected connection. UI teardown releases repository
watches/scope, never the SDK client. Collection changes await SDK selection
clearing and show close refusals without discarding the current ledger. Sign-out
waits for successful physical close; late actions from retired UI owners cannot
publish sign-out for a replacement owner. Identity uses the SDK's existing
canonical email or GitHub provider/login fields, never an account UUID or a
fabricated email.

When the
SDK reports `setup_required` (status or readiness assessment), the gate offers
**Set up TaskNotes Planner**, which reads the SDK setup plan and reviews its
plain summary, changes, conflicts and refusal. Confirm applies that original
plan; nothing-to-review keeps `configure()`. Unknown outcomes re-assess through
the SDK without claiming no writes or automatically submitting a fresh mutation.
Planner keeps no setup engine and never infers READY from a configure/apply
result: the ledger still waits for current SDK readiness. A failed or
missing settled readiness check offers **Check again**, which calls the SDK's
`assess()` with the current caller signal. Incompatible collections and retired
connections show a clear explanation and **Choose another collection**, rather
than an endless Opening message. Active SDK checks remain loading states; no
repository is allocated until aggregate readiness and the original connection
are current. Registered binding and popup reopen/expiry helpers remain producer work.

A link that requests an unapproved collection (`selection.state`
`approval_required`) or an invalid one offers **Approve this collection** or
**Choose another collection** (`chooseAnother()`); Planner never falls back to
another collection.

**Live hookup:** `plannerSdk()` is the page's one `MdbaseConnect`. Builds with
`VITE_MDBASE_ENV=lab` lazily render `App` over it (`components/root.tsx`); other
builds keep the existing Connect runtime because the SDK refuses production
(`application_production_trust_unavailable`). A LAB build also needs
`TASKNOTES_PLANNER_URL` set to its served origin so the manifest homepage matches.
`vite.config.ts` excludes the SDK from dev pre-bundling and emits ES workers.
The previous production build passed at `38001079`: it emits the SDK Worker,
`runtime-lab.wasm`, `sqlite3.wasm` and `sqlite3.js` once each, and the wasm
matches the SDK's asset pins. Live LAB registration and readiness have not been
exercised. Old local data and
pending writes need no cutover handoff for any app; ongoing new-SDK recovery
remains mandatory.

The original DEV/LAB intake `sdk-dev-1dddb04c` is installed through a
normal file dependency. It bundles the original beta129 protocol archive
(`c280cd194ffd`); Planner retains its direct `d765e675c3da` protocol dependency
for legacy packages. This archive has no vendor warnings; the earlier unused
protocol exception is not carried forward. Both original archives remain immutable. There are no aliases, API casts,
private source copies or package rewrites. This intake permits source typechecking,
not release or native qualification. UI lifecycle stand-ins and MemoryReplica
rendering tests do not qualify runtime, native initialization, registration or
end-to-end operation. No deployment or LAB pin change is enabled.

The current cut adds SDK-owned lazy Worker startup, pairing only from a sign-in
gesture, native-return opening and refused/expired sign-in recovery. SDK refusal
copy is rendered unchanged; Sign in stays enabled while authorizing and invokes
SDK `approve()`. Planner supplies no pairing or renewal engine.

## Artifact and checks

The SDK tarball and its source commit/SHA256 are recorded in
`vendor/mdbase-next-sdk.json`. It is supplied by the release workstream, not npm.
The current pin is the **development intake, not release-qualified**, from exact
SDK source `1dddb04cc423d07fcccedeedb0af2de2c2c6265a`, original `4c` cut:
4040076-byte SDK archive, SHA256
`e32d199f3c0839e4e7af76863599ec01954271c812fc03d1dc4e5105b6c79443`
(live `MdbaseConnect` entry: registration, storage, Worker and runtime, with
plain-Vite-emittable Worker and native assets since `d53d7d76`,
`snapshot.selection` and `approve`/`reauthorize`/`chooseAnother`; packages the
native runtime/SQLite wasm, `describe({ definitions })`, collection selection
and `files.grant`; adds contract-scoped `getContract` and contract
create/update/delete/rename, `files.watch` and `createType` in `df091839`;
MemoryReplica serves contract-scoped records from declared `MemoryContract`s in
`38001079`; `n1` adds atomic contract body/field updates and promotion, explicit
fixture digests; `4b` delivers public error/status helpers and portable/native-origin
sign-in APIs; `6a` includes registration-refusal guidance, Private-collection
availability reasons and collection deletion APIs; `993` adds owner-binding fixes
and public setup assessment, with the original 3555291-byte native runtime matching
`9f90af73e1591cafe9c35bdd42f18ae49d5a91a0186e78695e841fecabcd833a`;
`41c` adds per-type readiness options, SDK user-facing title/message/action labels,
log-service CORS support and a thin-client entry).
The direct legacy protocol beta129 dependency archive (source `d765e675c3da`) is
70702 bytes with SHA256
`2769616d8ba1a9cbb3dd689fa1ca0b1e2b42e5442634635f2cd4a87f5ec9020f`; it replaces
the earlier protocol718 `dfc5db0d` archive, including as the pnpm override for
the legacy Connect packages. SHA256/SHA512 were checked against the release
manifest. Relative to `e519009a`, the entry adds `assess()`, `configure()` and
`MdbaseApplicationConnection.displayName`, and the `@mdbase-dev/sdk/testing`
`createApplicationFixture` seam.
This dependency change does not by itself qualify native sign-in, READY,
deployment or a change to the held LAB SDK.

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

Task edits are written through the `tasknotes.task` contract
(`update(record, {contract, patch, unset, ifRevision})`): Planner sends contract
fields and Core maps them to the type's record fields. Task reads still map the
record fields client-side.

Unit tests use the SDK's MemoryReplica for record/receipt frames, with synthetic
native contract metadata, a declared `tasknotes.task` `MemoryContract` for
contract writes, and mocked AppBases results. SDK811's shared synthetic
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
