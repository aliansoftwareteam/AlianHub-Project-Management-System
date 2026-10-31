# Progress: Cloud orchestrator hardening

## Checklist

- [x] T1 host lifecycle: real `host.bootstrap` and `host.retire` in cloud mode, manual compute refuses
- [x] T1 failed bootstrap deletes its droplet and volume, sweep for stuck `provisioning` rows
- [x] T1 PR into alianhub-cloud `main`, based on cloud #7: alianhub-cloud#10
- [x] T2 DNS first on delete, bucket name saved first
- [x] T2 firewall on host bootstrap, SSH drop-in `00-alianhub.conf` and `ssh_pwauth: false`
- [x] T2 PR into alianhub-cloud `main`, based on cloud #7: alianhub-cloud#11
- [x] T3 pending approvals in the instance detail answer and page
- [x] T3 navigation badge and email to the other admins
- [x] T3 PR into alianhub-cloud `main`, based on cloud #7: alianhub-cloud#12
- [x] The three branches merged together locally pass every test suite
- [ ] Owner review and merge of #7, then #10, #11, #12
- [ ] Real checks on :4320 after merge (see "Last step")

## Last step

All three PRs are open and waiting for the owner (2026-10-31). After they're merged, check these on
:4320 with real providers, each only with the owner's go-ahead:

- One Add host and then Retire from the back office: the droplet appears, then goes.
- A new host has the `ah-tenant-host` firewall, and `sshd -T` on it says
  `passwordauthentication no`.
- One admin files a delete and a second admin sees the badge; the notice survives a refresh.

## Blockers

None. Cloud #7 must merge first; the three PRs are based on its branch.

## Log

### 2026-10-31
- Task created from the handoff's open bugs 10–12, the stuck-droplet gap and the pre-flight
  review. Owner chose all three parts and "delete it" for a droplet whose agent never reports.
- Numbered 082: 081 is kept for renumbering per-plan servers (the second 080), as the handoff
  suggests.
- Sweep threshold raised from 45 to 60 minutes before building: DigitalOcean's create and volume
  waits can each take 10 minutes, so a slow but healthy bootstrap can reach about 47 minutes.
- T1 (alianhub-cloud#10):
  - The cloud engine runs `host.bootstrap` and `host.retire`.
  - A failed or stuck host releases its droplet.
  - Only droplets tagged `ah-tenant-host` that no other live row uses are deleted, because ops
    can type a provider ID by hand.
  - `createManualCompute()` now says `manual: true`, as `hosts.js` expected.
- T2 (alianhub-cloud#11): delete starts with `dns_deleted`; `storageName` is saved before
  `createTenant`; `ensureFirewall` runs before each droplet is created; SSH passwords are off.
  - `OPS_SSH_SOURCES` is unset in the cloud `.env`, so new hosts get no SSH until the owner sets it.
- T3 (alianhub-cloud#12): `pendingApprovals` on the instance detail, `GET /approvals/waiting` for
  the navigation badge, and an `approval_requested` email to the other admins.
- Tests on the three branches merged together with #8: server 352, ops 34, agent 25, lint clean.
  The first combined server run had a transient start-up failure; two reruns passed.
- On the separate branches, `fleet.test.js` › "backup download link" fails on `main` as well;
  alianhub-cloud#8 (another session) fixes it.
