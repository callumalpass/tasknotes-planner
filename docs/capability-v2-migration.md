# Capability v2 migration — do not deploy

This is an unpublished SDK + v2 integration draft. **Do not merge into
auto-deploying main, push, publish, or deploy this branch.** The beta95 SDK
upgrade does not authorize release of this v2 declaration.

Required rollout order:

1. Deploy beta95 readers only, retaining fresh issuance v1 (`fresh=1`).
2. Subsequently qualify and deploy the v2 writer, retaining beta95 as rollback.
3. Only then qualify and release consumers declaring v2, including Planner.

The SDK may be beta95 before step 2; the consumer v2 manifest must not release
before the writer. Parent-owned LAB and signed staging/release evidence remain
separate prerequisites. Never substitute workspace packages or patch vendor
archives to hide an SDK defect.

## Current beta96 v2 candidate provenance

The active SDK pins now use authentic `0.1.0-beta.96` SHA-qualified development
packs from committed product source
`56ed32ffde0544ca497e854702d87ef2c175b954`, supplied by the parent at
`/home/calluma/projects/mdbase-connect/.ops/artifacts/v2-sdk-56ed32ffde05`.
The parent generated these with `pack-consumer-sdk.mjs` for phase
`v2-enablement`, supporting capability contracts `[1, 2]`.
These are **not signed Q artifacts or an npm publication**.

The existing vendor subset is preserved. Every copied archive was checked against
the supplied manifest's byte length and SHA-512, and its package version was
checked as `0.1.0-beta.96`. `vendor/mdbase-connect-sdk.json` records the new
revision, filenames, sizes and SHA-512 values. Dependency and transitive override
pins are updated together; package-manager installation regenerates the lockfile.
No archive is patched or relabelled and no package dependency is added.

The beta95 account below is historical, superseded for active pins by this
candidate. Release remains held: the parent owns rollout ordering, live/native
acceptance, and repinning immutable final release artifacts before consumer
publication if required. Existing v1 sessions remain retained; updated consent
requires explicit reauthorization without silent conversion or fallback.

## Historical beta95 provenance

The previous pins were **beta95-Q**, not enabled-candidate artifacts. Consumer
v2 enablement is authorized in the coordinated cycle; core issuance and SDK
generation remain parent-owned. At that stage, the parent needed to supply actual enabled-candidate
`package:consumer` output and update the connect/protocol/sync archives,
`vendor/mdbase-connect-sdk.json`, dependency/override pins and `pnpm-lock.yaml`
together. Record actual source revision, versions, sizes and hashes; do not
relabel beta95-Q or pin dirty Writer source. Repeat consumer checks against
those exact artifacts before live acceptance.

`vendor/mdbase-connect-sdk.json` is the connect/protocol/sync subset of product
`package:consumer` output from clean source
`408c67bc10f128e0833f0da62cb3efb9d94657d7`, version `0.1.0-beta.95`, supplied
in `/tmp/beta95-consumer-sdk.fmn7sH`. The parent verified artifact sizes,
SHA-512 values and versions. These are **SOURCE-BOUND local-build artifacts**,
not signed-image or published-registry release evidence. The old beta85 archives
are replaced, dependencies/overrides and the frozen lockfile use beta95 without
unrelated upgrades. Sync is retained and overridden to the matching artifact;
this connect package currently depends only on protocol, so Planner does not
import or install sync merely to claim replica support.

## Inventory and consent

The production generator is `scripts/planner-manifest.mjs`, invoked through
`pnpm manifest` / `scripts/write-manifest.mjs`. Its previous v1 requirements were:

- `collection.inspect`, `collection.setup.apply`
- `definitions.update`, `definitions.type-pack.apply`
- `records.watch`, `records.read`, `records.query`, `records.update`
- `views.list`, `views.execute`, `views.source.read`, `views.source.create`,
  `views.source.update`

It now declares `contract_version: 2` with exactly these required atomic groups
and no optional capabilities:

| Group                | Consent meaning                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `collection.read`    | Describe, changes, read/query, list/execute views, read view sources, validate records, and read types.                             |
| `records.edit`       | Update and rename records; no record creation or deletion.                                                                          |
| `views.manage`       | Create, update, and delete saved-view sources. Whole-group consent intentionally includes saved-view deletion, not record deletion. |
| `definitions.manage` | Create/update types and assess/apply type packs.                                                                                    |

Compared with the previous operation union, consent additionally covers record
validation, type reading, record rename, type creation, and saved-view source
deletion. These are atomic group meanings, not independently requested operation
permissions. Setup assessment/application is handled by Connect's separate
setup flow, with the existing provisions unchanged.

No `records.create`, `records.delete`, `offline.replica`, `files.*`, or
`background.schedule` is requested. Full-collection authorization remains
necessary for Bases, while the application continues to select and mutate task
records through `tasknotes.task` only. No app capability aliases or fabricated
SDK groups were introduced; session state handling remains SDK-owned.

## Preserved boundaries

The exact TaskNotes contracts, type-pack provisions, configuration requirement
and provision, and production callback are unchanged. Generated paths remain
`public/.well-known/mdbase-app.json` and `src/generated-mdbase-app.json`.
Development uses the existing documented `http://127.0.0.1:4174` origin only:
the invalid cross-origin localhost callback is removed. Runtime uses the declared
callback and rejects opening a connection from an undeclared origin with an
explicit URL instruction; origins are not broadened.

`scripts/planner-manifest.mjs` now invokes the installed protocol's strict
`parseAppManifest`, so normal manifest/build/verify fail on invalid declarations.
Local HTTP is accepted only in development. No v2-to-v1 compatibility fallback
is used. SDK session readiness owns consent, exact contract verification and
setup; the gate requires a user click to review updated access and never
silently upgrades the prior grant.

## Prior declaration-only evidence (superseded by beta95 checks below)

- `pnpm install --frozen-lockfile`, `pnpm manifest`: passed.
- `pnpm test`: 9 files, 56 tests passed, including exact group and generated
  manifest checks.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed. Build success does not
  demonstrate SDK runtime compatibility.
- Both production generated manifests passed the sibling feature Connect
  `packages/protocol/dist/manifest.js` `validateAppManifest` validator. This was
  a read-only local import; no Connect edits or production API calls.
- The unchanged development manifest fails that validator even with
  `allowLocal: true`: `/redirect_uris/1` uses localhost rather than the homepage's
  127.0.0.1 origin. Callback behavior was deliberately preserved, not silently
  changed to satisfy validation.
- The pinned beta85 SDK constructor accepts the declaration with explicit
  in-memory storage, but its real `effectiveCapabilities` evaluator throws
  `TypeError: APPLICATION_CAPABILITY_DEFINITIONS[capability] is not iterable`
  for the v2 declaration. This deterministic, no-network probe confirms the
  release blocker despite passing mocked application tests and build checks.

## Beta95 integration evidence (Node 24.19.0)

- Parent reran frozen install and full `pnpm verify`: formatting, typecheck,
  lint, all 65 tests, strict production manifest validation and build pass.
  Lockfile formatting churn was removed; the remaining diff is SDK-related.
  Parent independently verified all vendored artifact sizes and SHA-512 hashes.
- Genuine installed SDK construction, manifest loading and v2 capability
  evaluation pass without network; stale v1 operation sets and denied groups
  require authorization instead of throwing or silently upgrading.
- Real SDK application-session tests use fixture transport only: stale
  registration with sufficient operations still requires explicit consent;
  denied consent cannot apply setup; declaration mismatch and denied describe
  require authorization; missing exact contracts block readiness; matching
  contracts and current setup reach verified ready.
- UI regressions cover denied consent, explicit reauthorization, stale grants,
  startup/callback lifecycle and setup review. No timeout or budget is raised.

No browser/LAB acceptance, production smoke API, deployment, commit, or push is
performed. E2E is demo-only but requires a browser, prohibited for this task;
parent-owned isolated execution remains required. Parent LAB must verify real
consent denial/revocation, old-grant reauthorization, contract/type-pack setup,
Bases full-collection access and contract-scoped task edits with the qualified
writer and beta95 rollback. Local fixtures are not release acceptance.

## Coordinated consumer verification — 2026-09-09

With Node 24.19.0, the initial `pnpm test` passed 11 files / 65 tests;
`pnpm typecheck` and `pnpm build` passed, including strict manifest validation
and static callback verification. After extending repository regressions,
`pnpm test` passed 11 files / 66 tests and `pnpm typecheck` passed again.
The added assertions cover contract-scoped query/read/schedule updates with
revision guards, and saved-view updates preserving unrelated views/options
using the freshly read source revision. No runtime failure was found and no
additional group was requested to satisfy a test.

Parent LAB still needs fresh consent and stale v1 reauthorization, denied and
revoked access without clearing unrelated state, exact-contract/setup review,
date/dependency/status edits, saved-view list/execute/create/update, authority
failures and recovery across hosted and connected-computer collections. Tests
and builds here used fixtures/local artifacts only; no browser, LAB, smoke,
deployment or publication ran.

## Beta96 candidate integration results — 2026-09-09

- Full `pnpm verify`: passed, including formatting, typecheck, lint,
  **11 files / 66 tests**, strict manifest parsing and production build.
- Existing contract-scoped record/schedule and full-collection saved-view CAS
  regression assertions are preserved.

The installed beta96 SDK checks `/health` for
`application-authorization-v2-issuance` before fresh v2 authorization. TaskNotes,
Workouts and Pickle hermetic transport fixtures now model that endpoint; they
still assert exact signed intent and denial. Workouts additionally verifies a
v1-only server returns `capability_contract_incompatible` without an authorization
request or navigation. No production application source, authority declaration,
retained-session migration, or native route changed in this integration pass.

All checks used Node `v24.19.0` via the requested PATH. Initial cache writes
failed with `EROFS`; existing package-manager caches were copied into the private
log directory under `/tmp`, then offline installation succeeded in all four
worktrees (`pnpm install --no-frozen-lockfile --prod=false --offline --store-dir …`
or `npm install --include=dev --offline --cache …`). Lockfiles were regenerated
by package managers, with formatting restored where required. Every unrelated
package/snapshot lock entry is structurally unchanged from the starting draft.
No dependencies, audit waivers or timeout increases were introduced.

These are local fixture/unit results, not live browser, daemon, or native
acceptance. Parent acceptance still needs fresh registration and explicit v1
reauthorization, retained valid v1 grants, denial/revocation and recovery, exact
contract/setup and readonly view behavior, typed records and revision guards,
TaskNotes/Planner saved views, Workouts timers, and actual opt-in notifications
and opaque Pickle wakeups across the supported providers and native callbacks.
Parent owns release ordering and immutable final artifact repinning before
publication if required. Reader, bundled clients and canonical Connect were not
edited; no agents, browser operations, credentials, live service acceptance,
commits, pushes, publishing or deployments were used.

Private logs: `/tmp/v2-consumer-sdk-integration-20260909T130351/tasknotes-planner`.
