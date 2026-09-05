# 015 — Evidence gate (section E): would the owner answer these questions?

Run 2026-09-05 with `node scripts/ai-brief-evidence.js --env <repo>/.env` against the provider the dev API uses (`LLM_PROVIDER=openai`, model `gpt-4o`). Nothing below is hand-edited; the transcript is the script's output. Every question was answered "I don't know yet" so both rounds and the assumption path are exercised.

## Verdict: keep — 3 of 3 question sets are ones the owner would answer (gate needs 2 of 3)

| Brief | Coverage (round 1) | Questions | Would the owner answer? | Assumptions in the brief |
|---|---|---|---|---|
| Online store (ceramics maker) | 2 met, 3 missing | 3 (done_when, constraints, team) | **Yes.** "What does finished look like", "when and what can you spend", "who does the work" — each one click, options in the seller's own words. | 3, one per unknown answer |
| Mobile app (padel courts) | 2 met, 3 missing | 3 (existing, constraints, team) | **Yes**, with one weak option: "3 months, with a standard budget" — a club owner cannot tell what "standard" means; the Custom escape covers it. The `existing` chips (membership database, payment gateway, court scheduling, none) are exactly what a club owner knows. | 3, one per unknown answer |
| Multi-team system (ERP rollout) | 3 met, 2 missing | 2 (constraints, team) | **Yes.** Deadline + budget as one question, "who implements it per department" as the other. The budget presets (under $10k / up to $50k) are light for an ERP, but Custom is offered and the owner can choose it. | 2, one per unknown answer |

What the run shows against the acceptance criteria:

- **≤ 3 questions in round 1, ≤ 6 in total** — 3, 3 and 2. Round 2 asked nothing in all three cases because every point still missing had been answered "I don't know yet" in round 1, which the rules treat as final (never re-asked). A brief where round 1 answers are vague rather than unknown would get a round 2; that path is covered by `tests/ai-project-coverage.test.js`.
- **Only missing points are asked** — no question targets a `met` point in any run. Each question carries `point` and `allowUnknown: true`.
- **Every unknown answer became one assumption** — 3/3, 3/3, 2/2, and the drafted section for that point says "Assumed: …" so the owner sees the default in place.
- **Domain-agnostic** — the same five points scored a maker's shop, a club's app and a three-department rollout; no domain code ran. The scorer read "we sell at markets today" as `existing` met for the store and "everything has to line up at month end" as `done_when` met for the ERP; both are generous but defensible readings, and the reviewer notes say why.

Caveats to carry into the UI sweep:

1. **Example leakage on the store brief.** The clarify prompt's worked example is a ceramics store, and the model returned that example's questions and options nearly verbatim. The questions are still right for the owner, but the store run proves less than the other two. The mobile-app and ERP runs are the honest signal; both invented their own options.
2. **Assumption wording drifts.** The brief prompt asks for "No X given; planning for Y." The mobile-app run instead quoted the whole question in each assumption line, and the store run wrote "planning for a basic e-commerce functionality" for `done_when`, which is a weaker default than the section itself states. Readable, but the UI should show the assumption list as editable text.
3. **A brief-time number can contradict a question-time number.** The ERP question offered "budget under $10,000" as the recommended preset; the brief then assumed "under $100,000". Neither was chosen by the owner, so nothing is wrong, but the assumption is the one that reaches the plan.
4. **Cost per brief for the whole pre-plan flow** was $0.03–0.04 (coverage + clarify + coverage + coverage + brief). The second-round coverage call runs even when every remaining point was marked unknown; the UI can skip round 2 in that case and save ~$0.004.

---

# 015 evidence — coverage, clarify and brief on three thin briefs

Generated 2026-09-05T06:54:34.631Z by `scripts/ai-brief-evidence.js` against the configured provider. Every question was answered "I don't know yet" so the transcript shows both rounds and the assumptions the brief states in their place.

## Online store

**Brief as typed:**

```
An online store for our handmade ceramics.
We sell at markets today and want to sell online too.
```

### Round 1 of 2

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The project is an online store for handmade ceramics for current market customers. |
| `done_when` | missing | Specify how the owner will know the online store is finished, such as customers being able to order and pay online. |
| `existing` | met | The existing element is the current market sales of handmade ceramics. |
| `constraints` | missing | Include at least one constraint like a deadline, budget, or required platform. |
| `team` | missing | Specify who is on the team and their roles or skills, or who will do the work. |

> An online store for handmade ceramics, expanding from current market sales.

1. **What does 'finished' look like for the online store to you?**  
   point: `done_when` · type: `select_card` · category: `features` · allowUnknown: true
   - **Customers can order, pay and get shipping updates** (recommended) — A full buying flow including payment processing and order notifications.
   - Customers can browse and send an enquiry — A product catalogue with an enquiry form but no online payment.
   - Customers can pre-order upcoming items — Allowing customers to place deposits on future pieces, with fulfilment later.
   - hint: Most new online stores aim for a complete buying experience to start generating revenue.
   - rationale: Defines the scope of the first release and what features must be complete.
2. **When do you need the store live, and what is your budget for monthly tools or services?**  
   point: `constraints` · type: `preset_chips` · category: `timeline` · allowUnknown: true
   - **About 6 weeks, keep monthly costs under $50** (recommended)
   - Before the next market season, up to $200 a month
   - No fixed date, whatever it reasonably takes
   - Custom
   - hint: A six-week timeline with minimal costs is a common choice for small businesses starting online.
   - rationale: Determines the project timeline and whether to use free or paid tools.
3. **Who will be working on setting up and maintaining the online store?**  
   point: `team` · type: `select_card` · category: `audience` · allowUnknown: true
   - **Just me, in between making** (recommended) — Tasks will be planned for one person managing alongside other commitments.
   - Me plus a friend or family member who is good with computers — Some tasks can be delegated to a helper, allowing for more efficient setup.
   - I will hire someone for the setup — The plan will include steps for briefing and working with a freelancer.
   - hint: Many small business owners manage their online store themselves, especially at the start.
   - rationale: Defines who will be responsible for the tasks involved in launching and running the store.

_Usage: openai/gpt-4o, 4839 in + 890 out tokens, $0.0210_

_Answered "I don't know yet" to all 3._

### Round 2 of 2

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The project is an online store for handmade ceramics for current market customers. |
| `done_when` | missing | The brief does not specify how the owner will know it is finished; an assumption is needed. |
| `existing` | met | The existing element is the current market sales of handmade ceramics. |
| `constraints` | missing | The brief does not specify any constraints; an assumption is needed. |
| `team` | missing | The brief does not specify who will work on the project; an assumption is needed. |

_No questions: every point still missing was already asked (and left unknown), or every point is met._

_Usage: openai/gpt-4o, 970 in + 159 out tokens, $0.0040_

### Brief draft (all answers unknown)

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The project is an online store for handmade ceramics for current market customers. |
| `done_when` | missing | The brief does not specify how the owner will know the store is finished. |
| `existing` | met | The existing condition is selling at markets today. |
| `constraints` | missing | The brief does not specify any constraints like a deadline or budget. |
| `team` | missing | The brief does not specify who will work on the store or their skills. |

```markdown
## What and for whom
An online store for handmade ceramics, intended for current market customers to purchase products online.

## Done when
Assumed: the store is finished when customers can browse products, add them to a cart, and complete a purchase online.

## What already exists
The business currently sells handmade ceramics at markets.

## Constraints
Assumed: a six-week first release on a hosted platform with monthly costs under $50, since no date or budget was given.

## Team
Assumed: the owner will work alone, part-time, on setting up and maintaining the store.

## Assumptions
- The owner does not know yet what 'finished' looks like for the online store; planning for a basic e-commerce functionality.
- No launch date or budget given; planning for a six-week first release on a hosted platform costing under $50 a month.
- The owner does not know yet who will work on the store; planning for the owner working alone, part-time.
```

_Usage: openai/gpt-4o, 3508 in + 431 out tokens, $0.0131_

Questions asked in total: **3** (cap 6). Assumptions stated: **3**.

## Mobile app

**Brief as typed:**

```
A mobile app for booking padel courts at our two clubs.
Members should be able to book and pay in the app.
```

### Round 1 of 2

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The brief is for a mobile app for booking padel courts for members. |
| `done_when` | met | The app is done when members can book and pay in the app. |
| `existing` | missing | It is missing information on what existing systems or assets the app will start from. |
| `constraints` | missing | It is missing constraints such as deadlines, budget, or required technologies. |
| `team` | missing | It is missing information on who is on the team or who will do the work. |

> A mobile app for booking and paying for padel courts at two clubs, aimed at members.

1. **What existing systems or assets do you have that the app should integrate with or build upon?**  
   point: `existing` · type: `toggle_chips` · category: `integrations` · allowUnknown: true
   - **Membership database** (recommended)
   - Existing payment gateway
   - Court scheduling system
   - None of the above
   - hint: Most clubs have a membership database; integration with existing systems can streamline the app's functionality.
   - rationale: Identifies any existing systems or assets to integrate with, which affects the development plan.
2. **What are the constraints for the app development, such as deadlines or budget?**  
   point: `constraints` · type: `preset_chips` · category: `timeline` · allowUnknown: true
   - **3 months, with a standard budget** (recommended)
   - 6 months, with a flexible budget
   - No specific deadline or budget constraints
   - Custom
   - hint: A 3-month timeline with a standard budget is typical for similar app projects.
   - rationale: Helps determine the project timeline and budget allocation.
3. **Who will be on the team to develop the app, and what roles will they play?**  
   point: `team` · type: `select_card` · category: `audience` · allowUnknown: true
   - **Internal team** (recommended) — The app will be developed by our in-house team.
   - External agency — We will hire an external agency for the development.
   - Mixed team — A combination of internal staff and external freelancers.
   - hint: An internal team often provides better control and integration with existing processes.
   - rationale: Defines the team structure and helps allocate tasks accordingly.

_Usage: openai/gpt-4o, 4841 in + 807 out tokens, $0.0202_

_Answered "I don't know yet" to all 3._

### Round 2 of 2

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The app is for booking padel courts at two clubs for members. |
| `done_when` | met | The app is done when members can book and pay for courts in the app. |
| `existing` | missing | State an assumption about existing systems or assets. |
| `constraints` | missing | State an assumption about deadlines or budget. |
| `team` | missing | State an assumption about the team and their roles. |

_No questions: every point still missing was already asked (and left unknown), or every point is met._

_Usage: openai/gpt-4o, 979 in + 141 out tokens, $0.0039_

### Brief draft (all answers unknown)

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The app is for booking padel courts at two clubs for members. |
| `done_when` | met | The app is done when members can book and pay for courts in the app. |
| `existing` | missing | State what existing systems or assets the app should integrate with. |
| `constraints` | missing | State any deadlines, budget, or other constraints for development. |
| `team` | missing | State who will develop the app and their roles or skills. |

```markdown
## What and for whom
A mobile app for booking padel courts at two clubs, allowing members to book and pay for their court slots.

## Done when
The app is complete when members can book and pay for courts directly within the app.

## What already exists
Assumed: two operating clubs with a member list and a current booking method, since the owner does not know what existing systems or assets the app should integrate with.

## Constraints
Assumed: an eight-week first release with no fixed date or budget stated, as the owner does not know the constraints for app development.

## Team
Assumed: the owner plus one developer, since the owner does not know who will be on the team to develop the app.

## Assumptions
- The owner does not know yet: "What existing systems or assets do you have that the app should integrate with or build upon?" Planning for two operating clubs with a member list and a current manual booking method to migrate from.
- The owner does not know yet: "What are the constraints for the app development, such as deadlines or budget?" Planning for an eight-week first release with no fixed date or budget stated.
- The owner does not know yet: "Who will be on the team to develop the app, and what roles will they play?" Planning for the owner plus one developer.
```

_Usage: openai/gpt-4o, 3534 in + 463 out tokens, $0.0135_

Questions asked in total: **3** (cap 6). Assumptions stated: **3**.

## Multi-team system (ERP rollout)

**Brief as typed:**

```
Roll out a new ERP across Finance, Warehouse and Sales, replacing the spreadsheets each team runs today.
Everything has to line up at month end.
```

### Round 1 of 2

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The project is to roll out a new ERP for Finance, Warehouse, and Sales. |
| `done_when` | met | The project is done when everything lines up at month end. |
| `existing` | met | The work starts from spreadsheets currently used by each team. |
| `constraints` | missing | A specific date, budget, or tool requirement would make this met. |
| `team` | missing | Information about who is on the team or who will do the work is missing. |

> A rollout of a new ERP system for Finance, Warehouse, and Sales, replacing current spreadsheets, with completion targeted for month-end alignment.

1. **What is the deadline for the ERP rollout, and what is the budget for this project?**  
   point: `constraints` · type: `preset_chips` · category: `timeline` · allowUnknown: true
   - **End of quarter, budget under $10,000** (recommended)
   - Middle of the year, budget up to $50,000
   - Flexible timeline, budget over $50,000
   - Custom
   - hint: An end-of-quarter deadline with a lean budget is common for ERP rollouts in smaller organizations.
   - rationale: Determines the timeline for implementation and the resources available for the rollout.
2. **Who will be responsible for implementing the ERP system in each department?**  
   point: `team` · type: `select_card` · category: `audience` · allowUnknown: true
   - **Internal IT team** (recommended) — Your internal IT team will handle the entire implementation.
   - External consultant — An external consultant will manage the rollout.
   - Mixed team — A combination of internal staff and external consultants.
   - hint: Most organizations prefer using their internal IT team for better control and integration with existing processes.
   - rationale: Knowing the team helps allocate tasks and responsibilities effectively.

_Usage: openai/gpt-4o, 4841 in + 621 out tokens, $0.0183_

_Answered "I don't know yet" to all 2._

### Round 2 of 2

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The ERP is for Finance, Warehouse, and Sales to replace spreadsheets. |
| `done_when` | met | The ERP is done when everything lines up at month end. |
| `existing` | met | The work starts from spreadsheets currently used by each team. |
| `constraints` | missing | A deadline or budget is needed to meet this point. |
| `team` | missing | Information on who will implement the ERP in each department is needed. |

_No questions: every point still missing was already asked (and left unknown), or every point is met._

_Usage: openai/gpt-4o, 945 in + 145 out tokens, $0.0038_

### Brief draft (all answers unknown)

| Point | Verdict | Reviewer note |
|---|---|---|
| `what_for_whom` | met | The ERP is for Finance, Warehouse, and Sales teams to replace spreadsheets. |
| `done_when` | met | The ERP rollout is done when everything lines up at month end. |
| `existing` | met | The work starts from existing spreadsheets used by each team. |
| `constraints` | missing | A specific deadline or budget is needed to meet this point. |
| `team` | missing | Information on who will implement the ERP in each department is needed. |

```markdown
## What and for whom
The ERP system is for the Finance, Warehouse, and Sales teams to replace the spreadsheets each team currently uses.

## Done when
The ERP rollout is complete when all data and processes align correctly at month end.

## What already exists
The project starts from the existing spreadsheets used by each team in Finance, Warehouse, and Sales.

## Constraints
Assumed: a three-month rollout period with a budget under $100,000, since no specific deadline or budget was given.

## Team
Assumed: one lead per department to oversee the ERP implementation, since no specific team was named.

## Assumptions
- No launch date or budget given; planning for a three-month rollout with a budget under $100,000.
- No team named; planning for one lead per department to oversee the ERP implementation.
```

_Usage: openai/gpt-4o, 3422 in + 339 out tokens, $0.0119_

Questions asked in total: **2** (cap 6). Assumptions stated: **2**.
