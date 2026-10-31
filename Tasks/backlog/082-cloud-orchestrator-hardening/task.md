---
id: 082
title: Cloud orchestrator hardening — no droplet left billing, safer deletes and hosts, approvals that stay visible
status: backlog
priority: high
depends_on: [069, 070, 072]
created: 2026-10-31
---

# Cloud orchestrator hardening — no droplet left billing, safer deletes and hosts, approvals that stay visible

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Repo: `alianhub-cloud` · Fixes from the first real DigitalOcean run (2026-10-30) and the pre-flight review (2026-10-29)

## Goal

Before real customers, the control plane must never leave a droplet running that nobody sees, must
not open a subdomain to takeover or leak a bucket when something fails half-way, must lock new
hosts down, and must keep a two-admin approval in front of both admins until it is decided.

## Where we start

- **Bug 10.** In cloud mode the back office's Add host and Retire go to the simulator
  (`workflowEngine.js` `onHostChange` → `fallback`). Add host marks a host `active` with no server
  behind it; Retire marks the row `retired` and never deletes the droplet.
- **Stuck droplet.** When a droplet is created but its agent never reports, `runHostBootstrap`
  fails, the row stays `provisioning` with its `providerId`, and nothing deletes the droplet. A
  provision retry allocates a new host. A `provisioning` shared row also stops the warm spare
  forever. A control-plane restart during a bootstrap leaves the same state.
- **Delete order.** The delete workflow removes the stack, then storage, then DNS. A failure
  before `dns_deleted` leaves the A record on an IP DigitalOcean may hand to someone else.
- **Bucket name.** `storage_created` saves `storageName` only after `createTenant` succeeds. A
  half-made tenant is then deleted under the old `ahc-<id>` name, and the real bucket and IAM user
  stay. About 994 of Wasabi's 1,000 buckets are already used.
- **Firewall.** `ensureFirewall` exists but is never called, so `OPS_SSH_SOURCES` has no effect
  and ufw opens 22 to everyone.
- **SSH passwords.** The drop-in `60-alianhub.conf` is read after cloud-init's
  `50-cloud-init.conf`, so without `DO_SSH_KEY_IDS` password login stays on.
- **Bug 11.** The "waiting for a second admin" notice on the instance page is a transient ref; a
  refresh hides that an approval is pending.
- **Bug 12.** The second admin gets no badge or email; only Home shows a count.

## Scope

Three PRs into alianhub-cloud `main`, each based on `fix/droplet-names-and-deletes` (cloud #7),
whose droplet delete they reuse. None depends on another, so they merge in any order after #7.

### T1 — Host lifecycle in cloud mode (bug 10 and the stuck droplet)

1. **Real host workflows.** With a compute provider that creates servers (DigitalOcean), the
   workflow engine runs `host.bootstrap` and `host.retire` itself instead of the simulator:
   - `host.bootstrap` runs `runHostBootstrap` for the row the back office created: a droplet of
     the row's size and role, a volume as for that role, the agent, then the certificate.
   - `host.retire` deletes the droplet and its volumes with `compute.destroyHost`; a failure fails
     the job and raises `host_retire_failed` with the droplet's name and ID.
   - With `COMPUTE_PROVIDER=manual`, `host.bootstrap` fails at once with a message to register the
     host with `cloudctl host register`; the row stays `provisioning`. Local mode (074) is
     unchanged.
2. **A failed bootstrap leaves nothing behind** (owner, 2026-10-31: delete it). When the agent
   never reports, or the server step fails after DigitalOcean made a droplet, the droplet and its
   data volume are deleted and the row is `retired`. The `host_bootstrap_failed` alert names the
   droplet and says it was deleted. A failure at `edge_tls_pushed` keeps the host: it is up and
   reporting, and `tls renew` can push again.
3. **Sweep for stuck rows.** At engine start and every 5 minutes, a host still `provisioning`
   60 minutes after it was created is cleaned up the same way: droplet and volume deleted if one
   exists (found by `providerId` or by name), row retired, alert raised. Skipped for manual compute.
4. **Retry makes no second droplet unseen.** Because of 2 and 3, a retried provision may create a
   new host, but the old one is always deleted.

### T2 — Pre-flight safety fixes

1. **DNS first on delete:** `dns_deleted` runs before `stack_destroyed`.
2. **Bucket name saved first:** `storage_created` stores `storageName` before calling
   `createTenant`, so a retry or a delete uses the same name.
3. **Firewall on every new host:** host bootstrap calls `compute.ensureFirewall()` before creating
   the droplet (skipped for manual compute). The firewall is on the `ah-tenant-host` tag: 80 and
   443 from anywhere, 22 from `OPS_SSH_SOURCES` only, and no SSH at all when that is empty (the
   DigitalOcean Recovery Console still works).
4. **No SSH passwords:** the drop-in becomes `00-alianhub.conf`, and cloud-config sets
   `ssh_pwauth: false`.

### T3 — Two-admin approvals stay visible (bugs 11 and 12)

1. **Instance page:** the instance detail answer includes the instance's pending approvals
   (action, who asked, when, when it expires, whether it is mine). The page shows each as a
   lasting notice with a link to Approvals, after a refresh too.
2. **Badge for the second admin:** the Approvals item in the back office navigation shows how many
   pending approvals someone else asked for, refreshed on navigation and every minute.
3. **Email to the other admins** when an approval is requested, through the existing mail module;
   with no mail key set it is skipped, as other mail is today (bug 3).

## Out of scope

- Drain: it queues `move_host`, which is still simulated in cloud mode (bug 4, parked).
- Bugs 1–9 (the owner's "not now", 2026-10-30).
- The tarball SHA, CRLF and DNS-resolver workarounds from the pre-flight review.
- Creating the data volume before the droplet, and resizing a droplet on a plan change.
- Cleaning up existing provider resources by hand (done only when the owner asks).

## Acceptance criteria

- [ ] In cloud mode, Add host from the back office creates a droplet and the host becomes
      `active` only when its agent reports; Retire deletes the droplet and its volume.
- [ ] A bootstrap whose agent never reports leaves no droplet or volume, and the row is `retired`
      with an alert naming the droplet.
- [ ] A host left `provisioning` for 60 minutes (for example after a restart) is cleaned up by the
      sweep.
- [ ] With manual compute, Add host no longer marks a phantom host `active`.
- [ ] Delete removes the DNS record before anything else.
- [ ] A tenant that fails half-way through `createTenant` is deleted under its real bucket name.
- [ ] A new host gets the Cloud Firewall before its droplet exists, and password SSH is off.
- [ ] A pending approval shows on the instance page after a refresh, and the other admins see a
      badge and, with mail set up, an email.
- [ ] Server, ops, portal, shared and agent tests pass; lint is clean; new tests cover each item.

## Constraints & notes

- Owner's rules: open PRs, never merge them; no droplets, volumes, buckets or DNS records are
  created or deleted by hand while testing unless the owner asks. Tests use the fakes and
  `CLOUD_DRY_RUN`.
- Real check after merge: the next dedicated customer created and deleted on :4320, and one Add
  host plus Retire from the back office.
- Every back-office string through `ops/src/locales/en.js`; colours from tokens; minimal comments.

## Resources

None.
