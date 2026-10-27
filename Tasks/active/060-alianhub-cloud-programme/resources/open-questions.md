# AlianHub Cloud — open questions

Answer on your phone in any order; quote the number. Each question has the **default** the plan
uses until you say otherwise, so work can start on everything not marked **Blocking**.

Blocking = the named task cannot finish without the answer.

## Answers so far (owner, 27 Oct 2026)

| Q | Answer |
|---|---|
| Q1 | **Defaults**: Starter $29, Pro $79, Business $249 (limits in architecture §12); re-check Starter's price after the beta measures density |
| Q3 | **Open — decided last.** The payment gateway is the last thing built; provider chosen then |
| Q5 | **BLR1 (Bangalore)** |
| Q6 | **Open — decide later.** Build supports shared hosts and dedicated Business servers both |
| Q7 | **Yes** — MongoDB inside each customer's own stack |
| Q8 | **`<name>.alianhub.com`** |
| Q11 | **One tracker app for everyone** |
| Q16 | No preference → default kept |
| Q17 | **Automatic, in waves** |
| Q18 | **None** — no old Chargebee/Paddle customers to move |
| Q20 | **Only with the owner's OK** (time-boxed grant) |
| Q22 | No preference → default kept (2–3 developers) |
| Q25 | **Second to last.** Build the infrastructure first on the small servers a new account allows; raise DigitalOcean limits just before going live |
| Q26 | **Wasabi Singapore** for files (Spaces for backups) |

**Order the owner set:** infrastructure first → DigitalOcean account limits second to last →
payment gateway last. Not yet asked, defaults stand: Q2, Q4, Q9, Q10, Q12, Q13, Q14, Q15, Q19,
Q21, Q23, Q24.

## Business

**Q1 — Plans: names, seats, storage, prices.** *Blocking 067, 068.*
I read "Not S space: it will be fixed" as **Starter, with fixed storage**. Default: Starter $29
(10 seats, 20 GB fixed), Pro $79 (50 seats, 100 GB), Business $249 (150 seats, 500 GB, dedicated
server). Full table in [architecture.md §12](architecture.md#12-plans-and-add-ons-all-numbers-placeholder--q1-q2-q12).
On DigitalOcean a Starter stack costs $5.60–11.20 of server a month depending on how many fit on a
host, so $29 Starter gives ~53–72% margin. Default: keep $29 if the beta measures ≥ 45 Starter
stacks per 64 GiB server, otherwise $35–39.

**Q2 — Flat price per plan with a seat cap, or a price per user?**
Default: flat per plan with a cap, plus "+10 seats" packs. (Your message ties more storage to more
users, which reads as flat tiers.)

**Q3 — Payment provider, selling entity, and where customers are.** *Blocking 068 — which the owner
has put last (2026-10-27); decide when 068 starts.*
Recurring card payments in India need RBI e-mandates; selling abroad from India means GST on
exports (LUT) and foreign VAT/sales tax. Options:
- **Paddle or Lemon Squeezy** (merchant of record — they handle global tax and invoices, ~5% + 50¢).
- **Stripe** (cheapest, best subscriptions API; needs a non-India entity or Stripe India invite for
  international cards).
- **Razorpay Subscriptions** (best for India-only customers).
Default: build a provider adapter, start with **Paddle** if most customers are outside India,
**Razorpay** if most are in India.

**Q4 — Free trial, or pay before the instance is created?**
Your message says the user pays. Default: **pay first**, 14-day money-back guarantee, no trial.

**Q12 — Storage add-on size and price; what happens at the limit?**
Default: +50 GB for $10/month (Pro and Business). At 80% and 95% the owner is emailed and sees a
banner; at 100% new uploads are refused with a message — everything else keeps working.

**Q13 — When payment fails: how long until read-only, suspended, deleted?**
Default: 7 days full access with a banner → 7 days read-only → suspended until day 30 → stack
stopped, data kept 30 more days → deleted (final backup kept 30 days more).

**Q14 — AI features: customers bring their own key, or you sell AI credits?**
Default: bring your own key (works today). Credits can be an add-on later.

**Q18 — Are there paying customers on the old in-app Chargebee subscription to move over?**
Default: no; the Chargebee screens are hidden in managed mode.

**Q22 — Team size and the launch date you want.**
Default plan assumes 2–3 developers and ~16 weeks to public launch, with paying beta customers
from about week 6.

**Q23 — What is alianhub.com built with today (WordPress?) and who edits it?**
Default: the pricing page there reads plans from the portal API; sign-up starts on
account.alianhub.com.

## Hosting

**Q5 — Hosting provider and region.** ✅ *Answered 2026-10-27: DigitalOcean.*
Still open: which region(s) at launch? Default: one region — **BLR1 (Bangalore)** if customers are
mostly in India, **FRA1** for Europe, **NYC3** for the US. A region per customer choice comes later.
DigitalOcean findings, API choice and costs: [digitalocean.md](digitalocean.md) and task 070.

**Q6 — Starter and Pro share servers, Business gets its own server?**
Default: yes. Shared Droplets hold ~15–30 customer stacks each; Business gets a dedicated Droplet.

**Q7 — MongoDB inside each customer's Docker stack — is that what "Mugali will be the same Docker
instance" meant?**
Default: yes, one `mongo:7` container per customer inside their stack. (It also has to be, because
the app uses a fixed `global` database name, so two instances cannot share one Mongo server.)

**Q24 — Docker images: keep pulling the public image from GitHub (ghcr.io), or push every build
to DigitalOcean Container Registry too?**
You do not have to push to DigitalOcean: Droplets pull the public GHCR image. Default (from
[digitalocean.md](digitalocean.md)): GHCR stays the source; the release workflow also mirrors each
version to DigitalOcean Container Registry Basic ($5/month) so new servers and upgrades still work
during a GitHub outage. Start the beta on GHCR only, add the mirror in M4.

**Q25 — Prepay $1,000 to DigitalOcean (or request a limit increase)?**
✅ *Answered 2026-10-27: second to last — after the infrastructure is built, before going live.*
A new DigitalOcean account may run only 3 Droplets, Basic plans up to $48. The 64 GiB shared
servers and one Droplet per Business customer need Tier 4 (25 Droplets, all sizes), reached by a
$1,000 prepayment — it is credit, used up by the first month's bills — or by a limit increase
request (1–2 weeks). Until then development and testing run on 3 × Basic 4 vCPU / 8 GiB ($48).
Still to choose at that point: prepay or request.

**Q26 — Customer files on Wasabi or on DigitalOcean Spaces?**
Spaces keys can only be limited to a whole bucket, so per-customer isolation means a bucket per
server (one leaked key exposes ~30–60 customers). Wasabi can limit a key to one customer's folder,
but its nearest region to India is Singapore. Default: **Wasabi** for files, **Spaces** for backups
(no 90-day minimum charge). Choose Spaces if files must stay in India.

**Q17 — Upgrades: roll every customer automatically, or let them choose?**
Default: automatic, in waves (internal → 10% → everyone) inside a weekly window; Business picks
its window.

**Q19 — Can customers download their backups?**
Default: Pro and Business can download the latest nightly backup from the portal.

## Product

**Q8 — Instances at `<name>.alianhub.com` (as you said), or on a separate domain such as
`<name>.alianhub.app`?**
A separate domain isolates cookies and email reputation from the main site. Default: as you said,
`<name>.alianhub.com`, with host-only cookies on the portal so a tenant page cannot touch them.

**Q9 — Can a customer change their subdomain later?**
Default: yes, once every 30 days; the old name redirects for 30 days and is then held 90 days.

**Q10 — Customer's own domain (pm.acme.com) in the first release?**
Default: not in the first release; later as a Business feature and a Pro add-on.

**Q11 — Time tracker add-on: a separate build per customer, or one build that asks for the
workspace address?**
Your message describes generating a tracker per customer. Default: **one signed build for
everyone**; the customer types `acme.alianhub.com` once, or clicks "Open in tracker" in their
workspace. A build per customer means a code-signing and notarisation run per customer and per OS
on every tracker release (hours of CI, and macOS notarisation queues), and customers cannot update
from a shared update feed. Gating stays per customer: the tracker refuses to sign in to a workspace
without the add-on. Price default: $2 per tracked user per month, minimum 5.

**Q15 — Several workspaces inside one instance?**
Default: yes, up to the plan's limit (1 / 3 / 10); seats are counted across all of them.

**Q16 — What the customer's owner may change in Settings → Instance.**
Default: AI provider keys, Google/GitHub/GitLab sign-in, calling (TURN), product name.
Not editable: URLs, mail, storage, security/proxy, backups, upgrades, migrations, logs.

**Q20 — May our support staff sign in to a customer's instance?**
Default: only after the owner grants time-boxed support access (24 hours) from the portal; every
action is audited.

**Q21 — Mail: which relay, and may Business customers use their own SMTP?**
Confirmed: DigitalOcean blocks SMTP ports 25, 465 and 587 on **every** Droplet, with no documented
way to lift it ([digitalocean.md §13](digitalocean.md#13-outbound-email)), so mail must leave through
an HTTPS API. AlianHub already supports **Resend** over HTTPS (`RESEND_API_KEY`). Default: Resend on
a verified `alianhub.com` sending domain; Business may use its own provider only through an API key
or an SMTP provider on a non-standard port (e.g. 2525).
