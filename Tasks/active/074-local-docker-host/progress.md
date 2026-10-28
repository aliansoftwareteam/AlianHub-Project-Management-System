# Progress: Local Docker host — real AlianHub Cloud instances on a developer PC

## Checklist

- [x] T1 — Local edge: Traefik, registry, SeaweedFS, Mailpit (`local-host:up|down`)
- [x] T2 — Image from pre-staging into the local registry (`local-host:image`)
- [x] T3 — `ORCHESTRATOR_MODE=local`: step runner, resume, adapters
- [x] T4 — Provision workflow on real steps
- [x] T5 — Change workflows and instance calls
- [x] T6 — Usage polling
- [x] T7 — Capacity cap on this PC
- [x] T8 — Launcher switch, README, decisions
- [ ] End-to-end walkthrough against the acceptance criteria — by the owner (Claude's run below)

## Last step

Built on `feat/local-docker-host` in `F:/Projects/alianhub-cloud` and run for real on this PC; the
owner's manual walkthrough is next.

## Blockers

None.

## Log

### 2026-10-28
- Task created after the owner asked for a "proper simulation" using Docker on this PC. Decisions:
  - first slice of 069, not a throwaway tool;
  - self-signed certificates;
  - a local S3 server (SeaweedFS) for files.
- Built in `alianhub-cloud` (decisions 90–94):
  - `server/modules/orchestrator/workflowEngine.js`, `workflows/{runner,provision,changes,stack,entitlements}.js`
    and `adapters/{dockerHost,seaweedStore,local}.js`;
  - `dev/local-host/{up,down,image}.js`;
  - config `ENTITLEMENTS_SIGNING_KEY`, `MANAGED_DIR` and `LOCAL_HOST_*`.
- Fixed on the way: "Open AlianHub" and the staff support link read `url`, but the instance answers
  `loginUrl`, so both opened the bare address. They now read `loginUrl`.
- Run for real on this PC:
  - **Provision:** an invite redeemed in the portal reached `active` through all 11 steps; the stack
    came up in 29 s. Restarting the cloud server mid-provision resumed from `stack_started`, with no
    second stack, key or owner.
  - **Activation and links:** the ready email's activation link set the owner's password over
    https through Traefik. "Open AlianHub" gives a one-time sign-in link (the second use is refused).
    A support session started after the customer's grant.
  - **Plan change:** Pro with 5 tracker seats from the back office reached the instance as signed
    version 2, and the tracker handshake shows `enabled: true`.
  - **Suspend and resume:** suspend refused writes with the suspended message; resume restored
    `active`.
  - **Cancel and reactivate:** cancel stopped the stack and kept its volumes; reactivate brought it
    back and the owner's password still worked.
  - **Rename:** `localone` → `localrenamed` serves the new name; the old name gives 404, with no
    redirect locally.
  - **Mail:** the instance's reset email arrived in Mailpit from `no-reply@<host>`.
  - **S3:** put and get with the instance's key work. Its presigned link opens from the PC over
    http and https. Another bucket answers AccessDenied, and a second instance's key is refused on
    the first's bucket.
  - **Delete:** a second instance, ready in about 40 s, was deleted with no containers, volumes,
    tenant folder, bucket or key left.
  - **Usage:** back-office usage shows the instance's real report.
- Tests: `server/test/workflowEngine.test.js`, 9 tests against fake adapters:
  - every step and the signed first entitlements;
  - resume with nothing created twice, and a retried step;
  - capacity refusal and its alert;
  - plan push, lifecycle and delete;
  - real calls, with other hosts handed to the fallback;
  - local-mode config rules.
- Not run live: a 5th instance being refused (unit-tested only), the portal and back-office screens
  in a browser, real uploads through the AlianHub UI.
- The two simulated instances (`acmesmoke`, `abcaa`) stay simulated: they are active, so there is
  nothing to retry, and every call for them goes to the simulator.
