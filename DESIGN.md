# TaskNotes Planner design

## North star

**A planning ledger stretched across time.** The app shares TaskNotes' paper,
blue-black ink, quiet rules, Atkinson Hyperlegible type, Azeret Mono labels, and
muted blue accent. Its main surface is intentionally wider and denser than the
mobile TaskNotes app.

## Tokens

- Paper `#FFFFFF`
- Paper soft `#FAFBFC`
- Ink `#20242C`
- Ink soft `#505965`
- Rule `#E6EAF0`
- Accent `#356F96`

Dark appearance follows the same deep blue-black OKLCH roles as TaskNotes.

## Layout contract

The task ledger and timeline share one scroll container. The ledger remains
sticky horizontally, both headers remain sticky vertically, and every task row
therefore has one authoritative height. Do not split vertical scrolling between
the panes.

Task bars are compact and literal. Milestones are diamonds. Dependency paths,
the red today rule, and the schedule itself are the only visual marks allowed
over the timeline grid.

## Interaction contract

Zoom is continuous enough for orientation but resolves to six legible authored
scales. The date beneath the pointer (or viewport centre for buttons) remains
anchored while zooming. Schedule edits preview in place and persist on drop;
repository failures restore the previous task.

The whole bar moves a schedule, edge grips resize it, and the unscheduled affordance
places new work. Relationship handles sit below bar edges so they do not compete
with schedule manipulation. Connecting source and target edges determines the
TaskNotes `blockedBy` relationship type. The editor provides the non-pointer
equivalent and supports changing or removing existing relationships.

## Accessibility

Every task bar has a complete accessible schedule name, ledger and bar controls
open the same editor, appearance works in light and dark modes, and the editor
becomes a bottom sheet on narrow screens. Motion is removed when the operating
system requests reduced motion. Keyboard users can move and resize scheduled
tasks and can manage every relationship from the inspector.
