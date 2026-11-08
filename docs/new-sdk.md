# mdbase SDK data layer

Planner opens collections through the published `@mdbase-dev/sdk` in every
deployment. `src/data/sdk-application.ts` declares the application (canonical
manifest, homepage origin and the build's `VITE_MDBASE_ENV`: `lab`, `staging`,
or production when unset) and creates the page's one SDK entry. The shared
`@mdbase-dev/ui` collection gate owns sign-in, collection choice, setup and
problems; Planner supplies no auth, grant or setup engine of its own.
`NextPlannerRepository` implements `PlannerRepository` over the selected
connection's borrowed client.

## Data behavior

- Requires the exact portable `tasknotes.task` version and digest from the native
  catalog. Only implementing types are queried; canonical fields are mapped to
  each provider's actual field names. No default task-type fallback exists.
- Reads effective metadata without task bodies. Incomplete query results and
  duplicate portable task IDs are refused rather than published as a complete
  plan. Nested field-reference bindings are explicitly unsupported until the
  shared SDK provides nested updates.
- Reads the current task before editing, checks its portable identity and type,
  applies explicit CAS, and settles the write with `client.save()`: confirmed,
  or saved on this device while offline or the service is busy. Portable
  completion and dependency behavior still comes from `@tasknotes/model`.
- Unconfirmed writes belong to the SDK's write ledger, which persists them,
  restores them on reload and settles them from receipts. Planner keeps no
  pending-write list of its own and does not block edits behind one. A write
  the log refuses later appears as a dismissible notice (`client.ledger`
  rejected entries, acknowledged on dismiss). Protected/conflicted tasks must
  be resolved in TaskNotes.
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

View writes settle through `client.save()` too. A saved result requires an
unprotected current full-source readback and native discovery of the same
UUID/source revision/original ordinal. No separate autosave/session engine is
introduced.
