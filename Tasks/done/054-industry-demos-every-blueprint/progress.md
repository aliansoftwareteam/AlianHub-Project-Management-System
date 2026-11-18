# Progress: 054, industry demos for every blueprint

## Checklist

- [x] Industries from the README (the eight company blueprints) and the owner's answers: keep the four, add seven, industry-first names, seed all
- [x] PRD (task.md), confirmed by the owner
- [x] Seven new scenarios: Forgeline (manufacturing), Brightwave (agency), Cartwheel (e-commerce), Northgate (construction), Maple Grove (school), CareWell (clinic), Hartley & Moss (professional services)
- [x] The four renamed; industry labels for the seven; docs; tests
- [x] Seeded on the shared database (the eight blueprint companies)
- [x] Checked in the browser

## Log

### 2026-10-17
- The seven scenario files were drafted in parallel, one writer per industry, each checked with the same validator the seed runs; then one pass across all eleven: repeated people (five full names, several surnames) and two project codes (ORD, BILL) renamed so no two companies share a person or a code.
- The guide's "finished their steps" sentence now lists three or more roles as "the A, the B and the C".
- Content choices: CareWell is administrative only (no clinical detail; patients by initials); Maple Grove names pupils only by year group and first name with initial; Cartwheel's fulfilment partner was renamed so it does not share a name with Northgate.
- All eleven pass the validator; `tests/demo-industries.test.js` 62 pass, including two new checks (every name leads with its industry; every blueprint has a company); `i18n:check` and `style:check` pass.
- Seeding all eleven on the shared database stopped at the ninth: the Atlas cluster is shared-tier and caps collections at 500 across its databases; each company takes about 44, the live workspace 101 and `global` 30. The failed build left a database with no company row (11 collections); it was checked (no row, no members, created by this run) and dropped.
- Found while seeding: the seed's settle step stopped the automation engine one second after the story, but the event bus holds a task's emits for two seconds, so a move late in a story was never seen (Brightwave lost two of three runs). The settle step now waits past that window first; Brightwave was rebuilt and records all three.
- The owner chose to swap: Finance, Logistics and HR were removed from this database and School, Clinic and Professional Services seeded, so it holds the README's eight blueprint industries. All eleven stay in the code; the docs explain the limit and the `--only` list.
- Seeded: Maple Grove, CareWell and Hartley & Moss after the swap; every company's three automations fired (`success`), each has its routing (two or three tasks under Needs routing) and its workflow run waiting at an approval owned by the demo account, due in seven days. The cluster holds 493 of 500 collections.
- Browser (local build on :4100, both flags on, safety switches): the workspace picker lists the eight, each name leading with its industry; School · Maple Grove's Home shows the workflow approval with the Simulated chip and the proposals; its AI → Company view shows the education org chart (seven roles, supervised by the demo account) and the flow board.
- The full reset removed the demo account with the last company that held it and recreated it with `DEMO_PASSWORD` (052's behaviour); a server already signed in needs a fresh sign-in.

### 2026-10-19
- Merged into `staging` in [#1696](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/1696) (build 7, `14.40.0-beta.7`), together with tasks 052 and 053; the beta log records the build in the follow-up docs PR.

## Last step

Done. The shared demo database holds the eight blueprint companies; FinEdge, SwiftLogix and PeopleFirst are seeded only where the database has room.
