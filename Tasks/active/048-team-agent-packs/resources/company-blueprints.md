# Company blueprints: which agents a company needs, by industry and size

How a company of each kind is organised, which work in each department an agent can do, and how many agents it needs. An "agent" here is a role agent of task 048: a role with a detailed skill (like the Content Writer example) that works through a person's own connected AI or, with a server key, by itself through the dispatcher. Agents do the preparing, drafting, checking, sorting and reporting; people decide, approve, build, meet customers and own the result.

## Two numbers for every company

- **Agent roles:** how many different roles are switched on (Content Writer, Bug Triager …). Each role is one skill; it is set up once.
- **Agent seats:** how many copies of a role work at the same time. A seat is one connected AI (one person's Claude working that role's queue) or one in-product agent. Seats grow with the volume of work, not with the number of roles.

**Rule of thumb for seats:** one seat per role per **15 to 25 items a week** that role receives. A role agent clears an item in minutes, but each item waits for a person at its gate, so the person is the real limit: plan **one supervising person per 3 to 5 agent seats**, and never more seats than the project's places allow (3 per project by default, up to 20).

**Rule of thumb for roles by size:**

| Company size | People | Agent roles switched on | Agent seats | Supervising people |
|---|---|---|---|---|
| Small | 5 to 25 | 6 to 10 (the busiest roles of 2 or 3 departments) | 6 to 12 | the team leads, part of their week |
| Medium | 25 to 150 | 15 to 25 (most roles of 4 to 6 departments) | 20 to 50 | one lead per department |
| Large | 150 to 1,000 | 25 to 40 (all departments, some split by product line) | 60 to 200 | leads plus an "agent operations" owner who keeps rules, skills and the dispatcher right |

## 1. IT company (software product or IT services)

**How it works:** sales wins work or product decides what to build → design shapes it → engineering builds in sprints → QA checks → release → support handles customers → finance bills (services) or tracks revenue (product).

| Department | Human roles (who decides) | Agent roles beside them | Busiest items per week (medium company) |
|---|---|---|---|
| Leadership | CEO, CTO | Status Reporter (company digest), Risk Watch | 1 digest, 5 to 10 risks |
| Product | Product managers | PRD Writer, Feedback Collector (from support and sales into themes), Roadmap Keeper | 10 to 20 requests |
| Design | Designers, design lead | Design Lead (briefs), UI/UX Designer (specs), Design QA Reviewer, Brand Guardian | 10 to 20 briefs and reviews |
| Engineering | Developers, tech leads | Tech Lead (sprint plans), Bug Triager, Code Reviewer (PR summaries), Release Manager, Documentation Writer | 40 to 120 tasks, 20 to 60 bugs |
| QA | Testers | QA Engineer (test plans, cases), Regression Watch | 20 to 50 test items |
| DevOps / IT | Ops engineers | Incident Scribe (timeline, postmortem draft), Change Checklist | 5 to 15 changes |
| Support | Support agents | Support Agent (triage, draft replies a person sends), Support Lead (escalations, weekly summary), Knowledge Base Writer | 100 to 400 requests |
| Sales | Account executives | Sales Development Rep (follow-ups), Proposal Writer, Account Manager | 20 to 60 leads |
| Delivery (services firms) | Project managers | Project Planner, Client Status Reporter, Timesheet Checker | 5 to 15 projects |
| Finance / HR | Accountant, HR | Invoice Preparer (from approved timesheets), Onboarding Coordinator | 10 to 30 items |

**Sizing, 60-person software company:** about 20 agent roles, 30 to 40 seats (Bug Triager 3, Support Agent 6, Tech Lead 2, QA Engineer 3, others 1 or 2), supervised by 8 leads.

## 2. Manufacturing company

**How it works:** sales takes orders → planning schedules production (materials, machines, people) → purchasing buys materials → production makes the goods → quality inspects → maintenance keeps machines running → warehouse and logistics ship → finance bills; safety and compliance run across all.

| Department | Human roles | Agent roles beside them | Busiest items per week (medium plant) |
|---|---|---|---|
| Sales and orders | Sales, customer service | Order Intake (order into tasks, checks for missing data), Quote Preparer, Customer Update Writer | 30 to 100 orders |
| Production planning | Planner | Production Planner (weekly plan from orders and capacity), Schedule Change Watch | 1 plan, 10 to 30 changes |
| Purchasing | Buyers | Purchase Request Preparer, Supplier Follow-up (late deliveries), Supplier Scorecard | 20 to 80 requests |
| Production | Supervisors, operators | Shift Handover Writer, Work Instruction Keeper, Downtime Logger | 15 to 21 shifts |
| Quality | Quality engineers, inspectors | Inspection Checklist, Non-conformance Recorder (issue, cause, action), Corrective Action Tracker (8D/CAPA follow-up) | 10 to 40 issues |
| Maintenance | Technicians | Maintenance Planner (preventive schedule), Breakdown Triage, Spare Parts Watch | 20 to 60 work orders |
| Warehouse and logistics | Storekeepers, dispatch | Dispatch Checklist, Stock Alert, Delivery Tracker | 30 to 100 shipments |
| Health, safety, environment | HSE officer | Incident Reporter, Audit Checklist, Training Due Watch | 5 to 20 items |
| Engineering / R&D | Engineers | Change Request Writer (ECO), Drawing Revision Tracker | 5 to 15 changes |
| Finance / HR | Accounts, HR | Invoice Preparer, Shift Roster Checker, Training Records | 20 to 50 items |

**What agents never do in a plant:** start or stop a machine, release a batch, sign off quality or safety, or order from a supplier. They prepare, record and remind; a person decides and acts.

**Sizing, 200-person plant:** about 22 agent roles, 35 to 50 seats (Order Intake 3, Non-conformance Recorder 3, Maintenance Planner 3, Shift Handover Writer 3, others 1 or 2), supervised by department heads and one agent-operations owner.

## 3. Marketing or creative agency

**How it works:** account managers win and run clients → strategists plan → creatives make (copy, design, video) → reviews and client approval → publish or deliver → report results → bill.

| Department | Agent roles |
|---|---|
| Accounts | Account Manager (client status, meeting notes into tasks), Proposal Writer |
| Strategy | Campaign Manager (plan into tasks), Research Brief Writer |
| Creative | Content Writer, SEO Specialist, Social Media Manager, Design Lead (briefs), Brand Guardian |
| Delivery | Project Planner, Client Approval Tracker |
| Analytics | Marketing Analyst (results report) |
| Finance | Timesheet Checker, Invoice Preparer |

**Sizing, 30-person agency:** 12 to 15 roles, 20 to 25 seats (Content Writer 4, Social Media Manager 3, Account Manager 3).

## 4. E-commerce or retail

**How it works:** buying and merchandising choose products → catalogue lists them → marketing brings customers → orders are fulfilled → customer service handles questions and returns → finance reconciles.

Agent roles: Product Listing Writer, Catalogue Checker (missing images, prices, sizes), Promotion Planner, Content Writer, Social Media Manager, Order Issue Triage, Returns Coordinator, Customer Service Agent (draft replies a person sends), Stock Alert, Supplier Follow-up, Weekly Sales Reporter. **Sizing, 40 people:** 12 to 15 roles, 20 to 30 seats, most in customer service and listings.

## 5. Construction and engineering projects

**How it works:** tendering wins the job → planning and design → procurement → site work in stages → inspections and safety → handover → billing by milestone.

Agent roles: Tender Document Checker, Project Planner (stages, milestones), Site Daily Report Writer, RFI Tracker (requests for information), Snag List Keeper, Safety Checklist, Subcontractor Follow-up, Milestone Billing Preparer, Handover Pack Builder. **Sizing, 100 people over 6 sites:** 10 to 14 roles, 20 to 30 seats (one Site Daily Report Writer per site).

## 6. Professional services (consulting, accounting, legal)

**How it works:** win the client → scope the engagement → do the work in deliverables → review by a senior → deliver → bill time.

Agent roles: Engagement Planner, Research Brief Writer, Document Drafter (first drafts for a professional to review), Review Checklist, Deadline Watch (filings, court or tax dates), Client Status Reporter, Timesheet Checker, Invoice Preparer. **Sizing, 50 people:** 8 to 12 roles, 15 to 25 seats.

## 7. Education and training

Agent roles: Course Planner, Lesson Material Drafter, Assignment Feedback Drafter (for the teacher to edit), Student Query Triage, Attendance Watch, Schedule Keeper, Parent Update Writer (sent by a person). **Sizing, a school of 60 staff:** 8 to 10 roles, 15 to 25 seats.

## 8. Healthcare clinic (admin side only)

Agent roles for administration only, never for clinical decisions: Appointment Follow-up List, Supplies Stock Alert, Staff Roster Checker, Compliance Checklist, Patient Feedback Summary (no patient data leaves the clinic's own workspace). **Sizing, 40 staff:** 5 to 7 roles, 8 to 12 seats.

## How a company starts

1. **Pick its blueprint** (IT company, Manufacturing, Agency, E-commerce, Construction, Professional services, Education, Clinic admin). The blueprint switches on the departments' packs and the dispatcher rules that fit them, all in suggest mode.
2. **Start small:** the 3 busiest roles of 2 departments for two weeks (for an IT company: Bug Triager, Support Agent, Tech Lead; for a plant: Order Intake, Non-conformance Recorder, Maintenance Planner).
3. **Watch the company view:** queue length per role, items waiting at gates, how often the dispatcher was overridden. Add a seat where a queue grows, a rule where overrides repeat, a role where people keep doing the same preparing by hand.
4. **Grow by department** until the size table above is reached.

## What this adds to task 048

- **Blueprints as data:** each blueprint lists its departments, the role agents per department (role skills of part 1, plus new roles for manufacturing, construction, retail, services, education and clinic admin), the dispatcher rules to start with, the workflows that fit, and the suggested seats by company size.
- **A blueprint picker** in AI (and as a step of "Connect your AI" for a new workspace): choose the industry and size, see the roles and seats it suggests, switch on the first three roles.
- **More roles:** the 20 roles of the first four teams cover IT companies and agencies; manufacturing needs about 20 more, the other industries 5 to 10 each, many shared (Invoice Preparer, Deadline Watch, Status Reporter, Timesheet Checker).
