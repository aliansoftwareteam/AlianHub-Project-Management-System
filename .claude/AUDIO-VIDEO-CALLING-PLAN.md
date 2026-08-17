# Audio / Video Calling in Main Chat — Approach & Plan

**Task:** AHE-3839 · **Status:** proposal, nothing built
**Date:** 2026-08-11

---

## 1. What we already have

Investigated before choosing an approach. Three findings change the answer materially.

**Signalling is already built and authenticated.** `socket/socketinit.js` runs a per-user
Socket.io namespace, `io.of(/^\/userid_\w+$/)`, gated by JWT verification on the handshake.
That is precisely what a call needs: a reliable, authenticated way to reach *one specific
user* on all their open devices. Most WebRTC projects spend their first sprint building
this. We have it.

**The chat model is 1:1.** A main chat is a task with `mainChat: true` and the two
participants in `AssigneeUserId[0]` / `AssigneeUserId[1]` (`socket/controller/chatSocket.js`).
So the common case — ring one person from a conversation — maps directly onto peer-to-peer.

**Media capture patterns already exist.** `MainChatRecorder.vue` already calls
`navigator.mediaDevices.getUserMedia`, enumerates devices, and handles the unsupported case.
Permission prompts, device pickers and the "no mic" fallback are solved problems in this
codebase.

**Nothing WebRTC-related is installed.** No peer, RTC, TURN or SFU dependency in
`package.json`. Greenfield on the media side.

**Deployment is self-hosted Docker** (`Dockerfile`, `docker-compose.yml`), AGPL-3.0. The
product's stated positioning is "run on your own servers… no vendor lock-in… compliance
with data residency requirements". That constrains the choice more than any technical
factor — see below.

---

## 2. The options

### A. Peer-to-peer WebRTC, signalled over our existing Socket.io

Browsers connect directly; media never touches our server. We only pass the offer/answer
and ICE candidates through the socket namespace that already exists.

- **Cost:** zero per-minute. No media server.
- **Privacy:** media is end-to-end between the two browsers. Nothing to store, nothing to
  leak, nothing for a self-hoster to worry about.
- **Limit:** each peer uploads its stream to every other peer, so quality collapses past
  roughly 4 participants. Fine for 1:1, poor for a real "meeting".
- **Requires TURN** for the minority of networks P2P cannot traverse (see §4).

### B. Self-hosted SFU (LiveKit, mediasoup, Jitsi Videobridge)

A media server receives each participant's stream once and forwards it. Scales to real
meetings (10–50).

- **Scales properly**, supports screen share and server-side recording.
- **Cost:** a second server to run, size and secure — for us *and for every self-hoster*.
  LiveKit is Apache-2.0 and Docker-friendly, which makes this the least painful SFU, but it
  is still new infrastructure in every deployment.
- **Effort:** high, and most of it is operational rather than code.

### C. Embed Jitsi Meet (iframe / External API)

Point an iframe at `meet.jit.si` or a self-hosted Jitsi.

- **Fastest to ship** by a wide margin — group calls, screen share and recording for free.
- **But `meet.jit.si` is a third party.** Media and metadata leave the customer's
  infrastructure, which contradicts the data-residency promise. Self-hosting Jitsi means
  running Prosody, Jicofo and JVB — heavier than option B's LiveKit.
- **Little UI control.** It is someone else's product in a frame; ringing, presence and
  chat integration sit awkwardly around it.

### D. SaaS provider (Twilio, Daily, Agora, 100ms)

- **Most reliable, least code.**
- **Wrong shape for this product.** Every self-hoster would need their own account, API
  keys and per-minute billing before calling worked at all — and media would flow through a
  vendor. It contradicts the two things AlianHub sells: self-hosting and data control.

---

## 3. Recommendation

**Phase 1: peer-to-peer 1:1 calling (option A), signalled over the existing namespace.
Phase 2: optional self-hosted SFU (option B) for group meetings, behind config.**

Reasons, in order of weight:

1. **It fits what the product promises.** A, and only A, requires no third party and no new
   paid dependency. For a self-hosted AGPL product this is close to decisive.
2. **The expensive half is already built.** Authenticated signalling to a specific user is
   the part teams underestimate; we have it, tested, in production.
3. **1:1 is the actual shape of main chat today.** We would be building group calling for a
   module that has no group conversations modelled — solving a problem we do not yet have.
4. **It is not a dead end.** Ringing, accept/reject, device selection, permissions, the call
   window, missed-call messages and reconnect logic are all transport-independent. Adding an
   SFU later swaps what sits under `getUserMedia` → `PeerConnection`; the surrounding 80%
   carries over untouched.

**What would change this recommendation:** if "Meeting" in the task title means group calls
are required in v1, skip straight to LiveKit (B) — mesh will not carry a 6-person call and
building P2P first would be wasted. That is the single biggest open question (§7).

---

## 4. The two things that decide whether this works

Both are commonly discovered late, and both are infrastructure, not code.

### TURN is not optional

P2P fails on symmetric NAT and restrictive corporate firewalls — in practice **15–20% of
real-world connections**. Those calls need a TURN relay, which is a server that forwards
media when a direct path cannot be found.

- Ship **coturn** as an optional service in `docker-compose.yml`.
- Make the ICE server list **env-driven** (`TURN_URL`, `TURN_USER`, `TURN_PASSWORD`), so a
  self-hoster can point at their own or a managed TURN.
- Without TURN configured, calls will work for most users and **silently fail for some**.
  That must be surfaced in the UI ("could not connect — your network may require a relay"),
  not left as a mystery.
- TURN relays media, so it costs bandwidth. Size it for concurrent calls, not total users.

### HTTPS is mandatory

`getUserMedia` only works in a secure context. A self-hoster on plain HTTP will find calling
silently unavailable. Detect it and say so explicitly rather than showing a dead button.

---

## 5. Implementation plan — Phase 1

Sequenced so each step is independently testable.

**1. Signalling channel** — a `callSocket` controller alongside the existing ones. Events:
`call:invite`, `call:accept`, `call:reject`, `call:cancel`, `call:end`, `call:ice`,
`call:offer`, `call:answer`. Routed through the per-user namespace.

**2. Authorisation.** The callee must be verified as a participant of that chat, server-side,
derived from the chat's `AssigneeUserId` — never from the request body. Without this, anyone
who can guess a user id can ring anyone in the company. This mirrors the rule already
established elsewhere in this codebase: identity comes from the session, never the payload.

**3. Multi-device ringing.** A user may have several sockets (tabs, desktop). Ring all of
them, first to answer wins, immediately cancel the rest — otherwise a call answered on the
phone keeps ringing the laptop.

**4. Call state machine** — `idle → ringing → connecting → active → ended`, with explicit
timeouts (no answer after ~45s = missed). Encoded once, server-side, so both clients agree.

**5. Media layer.** `RTCPeerConnection` with the env-driven ICE config; device selection
reusing the patterns in `MainChatRecorder.vue`; audio-only and video modes.

**6. UI.** Call button in `MainChatHeader.vue`; an incoming-call prompt that is reachable
from anywhere in the app, not only when the chat is open; an in-call window with mute,
camera toggle and hang-up.

**7. Chat integration.** Post a system message into the conversation on call end —
"Call · 4m 12s" or "Missed call" — so history is visible where people look for it.

**8. Failure handling.** Permission denied, no device, insecure context, ICE failure, peer
disconnect. Each with a message that says what to do.

### Phase 2 (later, if group calling is confirmed)

Add LiveKit as an **optional** service. If `LIVEKIT_URL` is configured, group calls route
through it; if not, group calling is hidden and 1:1 continues to work P2P. Screen share and
recording become available at the same time, since the SFU provides both.

---

## 6. What this does **not** cover

Stated so scope is explicit, not discovered mid-build: group meetings (Phase 2), screen
sharing, recording, calls to external/non-member participants, dial-in numbers, live
captions, and calling from the Electron tracker app.

---

## 7. Decisions needed before building

1. **Is group calling required in v1?** This is the fork. 1:1 only → build P2P now. Group
   required → go straight to LiveKit and accept the operational cost.
2. **Is screen sharing required?** It works P2P for 1:1, so it is cheap in Phase 1 — but
   only if we know now.
3. **Is call recording required?** If yes, P2P is the wrong base entirely; recording
   effectively requires a media server.
4. **Can we mandate HTTPS + a TURN server** for deployments that want calling, and document
   it as a requirement?
5. **Audio-only first?** Roughly 60% of the work for most of the value, and it lets the
   signalling, ringing and state machine be proven before video is added.

---

## 8. Rough sizing

Phase 1, 1:1 audio + video, assuming the answers above are "1:1, no recording":

| Piece | Estimate |
|---|---|
| Signalling controller + authorisation + state machine | 2–3 days |
| WebRTC media layer, ICE/TURN config, device handling | 3–4 days |
| UI: call button, incoming prompt, in-call window | 3–4 days |
| Chat history integration, failure states, polish | 2–3 days |
| coturn in compose + deployment docs | 1 day |

**≈ 11–15 days** for a solid 1:1 implementation, excluding QA across networks — which is the
part that always takes longer than expected, because NAT traversal only misbehaves on real
networks, never on localhost.

Note the current task estimate is **6h**, which is not close to any of these options. Worth
re-estimating once the scope questions are answered.
