# 041 progress

- [x] 1 Chat AI buttons do something (#1117, build 577)
- [x] 2 Approvals and Teammates (#1111, build 568)
- [x] 3 Ask is the AI home (#1115, build 575)
- [x] 4 Ask answers inside ⌘K (#1113, build 572)
- [x] 5 Ask understands structure (#1123, build 580)
- [x] 6 Ask is a conversation (#1121, build 591)
- [x] 7 Plain-language agents (#1116, build 590)
- [x] 8 Preview, then apply, for every AI write (#1120, build 585)
- [x] 9 Agents where people work (#1124, build 597)
- [x] 10 AI on Home (#1125, build 593)
- [x] 11 One AI availability state (#1122, build 609)
- [x] 12 Automatic assignment: an assign action and AI assignment rules (#1157 build 625, #1159 build 629)
- [x] Follow-ups: plain proposal titles everywhere; dark-mode description, comments and Ask lists (#1154, build 615)

## Log
- 2026-09-28: AI comparison with ClickUp written (task 034 findings); three slices started in parallel.
- 2026-09-28: slices 4–6 (recommendations 3–5) added and started in parallel.
- 2026-09-28: slices 7–11 (recommendations 6–10) added. They start as agent slots free up: 7 and 8 first, 9 after slice 1 merges (chat composer), 10 after slice 3 (AI navigation), 11 last because it touches every AI entry point.
- 2026-09-28: slices 1–10 merged (builds 568–597). Owner decision: keep the code-based autonomy names from #1116. L0 "Answers and suggests", L1 "Suggests changes", L2 "Acts, you approve the rest", L3 "Acts, also on a schedule".
- 2026-09-28: security follow-ups merged. #1140 (build 601): project template writes need owner or admin. #1141 (build 604): every run a person starts needs access to its task.
- 2026-09-28: slice 12 started (after the owner's ClickUp AI Assignee screenshot): 12a, an "Assign to" automation action; 12b, AI assignment rules per project. A dark-mode and plain-label follow-up also started.
- 2026-09-28: all slices merged. Slice 12a uses one assignee write path (`updateAssignee` with `eventActor` and `eventDepth`). Related fixes merged: #1148 (localePreferences schema, build 612) and #1143 (startup migration version, build 608).
