# Addendum: a pack brings its playbooks' setup (AP-493)

Follows pack run 2 (manufacturing), finding 6, and a gap in starter rules of kind `type`.

## Goal

When a team pack is applied to a fresh project, its roles can reach their main output: the fields their playbooks fill are proposed, and a role whose starter rule names a missing task type still routes, on its tag.

## Scope

- **Type rule falls back to a tag.** A `type:<name>` starter rule the project cannot place (no such task type) becomes a tag rule on the role's own tag of the same name (Bug Triager: type Bug, tag `bug`). The tag rule is made at once when the project has the tag, or waits on the pack's tag approval through the existing `waitingRules`. The apply result lists each fallback; the page says "Bug Triager will route on tag bug, because the project has no Bug type".
- **Playbooks declare fields.** New optional front matter `fields: [Name:type, Name:dropdown(A|B)]`, at most 6 per role, only types the field form offers (no rollups or formulas), at most 10 dropdown options. Added to Order Intake, Non-conformance Recorder, Maintenance Planner and Bug Triager. Order Intake also declares its tags `order-to-confirm` and `ready-for-planning`.
- **One field approval per project per apply.** With `proposeFields: true` the apply files one proposal from the team pack that runs `fields.create` for the fields the project lacks by name (deduplicated across roles); none when a pending pack proposal already asks for them, none when agents cannot add fields. The result shows the names, like the tag approval. The pack page and the blueprint picker send `proposeFields: true` with `proposeTags: true`.
- **Undo.** Undoing the pack withdraws a field approval nobody has decided. Fields already approved stay, and the page says so.

## Out of scope

Documents a playbook expects (part list, machine plans), a blueprint project template, starter rules on a field.

## Acceptance criteria

- [ ] A Bug Triager type rule on a project without a Bug type waits on the `bug` tag approval and becomes an active tag rule when it is approved.
- [ ] One field proposal per project carries only the missing fields; a field the project has by name is skipped; a second apply files none while the first waits.
- [ ] Undo withdraws a pending field proposal; approved fields stay.
- [ ] Another company cannot reach the proposal.
- [ ] The parser validates `fields:` (type, dropdown options, cap, duplicates).
- [ ] The pack page and the blueprint picker send `proposeFields` and show the fallback and field lines.
