---
type: audit
goal: G-012
date: 2026-05-24
status: addressed
addressed_date: 2026-05-24
---

# Audit: Hetzner personal-PaaS: project.play.ris.hair routing via Cloudflare Tunnel with Cloudflare Access

## Overall Assessment

The plan is structurally sound and well-motivated — the user's framing (Hetzner = personal/play, Cloudflare = public/production) translates cleanly into the chosen primitives (one Tunnel + one Access policy + per-project systemd user units + tiny CLI). Confidence that executing it as-is produces a working `status.play.ris.hair` with CF Access auth is moderate-high (~70%), but there are real correctness gaps around the systemd `--user` lifecycle (lingering, ordering, reboot path), the atomicity of tunnel-config mutation, the `.local-dev.yaml` schema's silent gaps (port allocation, secrets ownership, conflict detection), and one cross-goal dependency that is currently wired backwards (E-049 depends on E-051, but E-051's own success criteria reference E-049 — they share a verification and should be reconciled or merged).

The bigger spiritual concern is more subtle: the plan **assumes Cloudflare Tunnel is the right primitive** and forecloses the comparison. Given the 2026 landscape (Tailscale Funnel/Serve, Pomerium, Caddy-with-Cloudflare-Origin-CA, even just `wireguard + Caddy` for "only me" cases) and the user's stated framing ("doesn't have to be complex"), R-019 should at minimum surface the alternatives in one paragraph so the choice is informed rather than inherited. Tunnel is probably right, but "probably right" isn't the same as "validated against the field."

## Strengths

The goal's outcome statement is tight and falsifiable: "adding a new project takes one command and a tiny YAML file." That's a real success metric, not aspirational language.

The dogfood-as-exit-criterion pattern (G-013 hosts itself via G-012, and G-012 isn't done until G-013 deploys cleanly) is the right shape for a tools-building goal. It guarantees the abstraction gets stressed by a real consumer rather than just dummy tests.

The choice of systemd user units over tmux/pm2 is correctly motivated ("one less moving part") and aligns with the user's general preference for using already-installed system primitives over adding tools. `journalctl --user -u <unit>` for logs is the right consumer-facing affordance.

The schema sketch in E-048 step 2 is appropriately minimal for v1 — `subdomain`, `port`, `command`, `mode`, `working_dir`, `env_file`, `restart` covers the 80% case without inventing knobs nobody will use.

The blast-radius sections are accurate and modest — installing cloudflared is well-trusted, adding a system service is reversible, no public ports get opened on the Hetzner box. This is exactly the threat-model framing that makes review easy.

The "no Hetzner public ports for the tunnel" requirement is named explicitly as a success criterion (`netstat -tlnp` check in E-047). That's a real security property, not a vague gesture, and it's verifiable.

R-019's question list is largely the right list — it covers WebSockets/HMR/SSE for the Next.js apps that will run behind the tunnel, DNS prerequisites, and the system-vs-user systemd coordination question.

## Issues

### Critical (must address before execution)

**1. The systemd `--user` reboot story is incomplete and untested.** By default, `systemctl --user` services **do not start on boot unless the user has lingering enabled** (`loginctl enable-linger <user>`). Without this, the entire PaaS dies on every Hetzner reboot — exactly the opposite of the "survives reboots" exit criterion. The goal lists "Process supervision via `systemd` user units ... so projects survive reboots" as a must-have, and E-049 says "A reboot of the Hetzner box ... brings the dashboard back up automatically" as a success criterion. But none of the experiments mention `loginctl enable-linger`, and `systemctl --user` units don't get a meaningful boot-order story relative to network-online or to the `cloudflared` system service (which is in a completely different cgroup/scope).

Concretely, the failure mode you'll hit:
- Hetzner reboots
- `cloudflared` system service starts, opens the tunnel
- Tunnel ingress rules say `status.play.ris.hair` → `localhost:4001`
- But `paas-status.service` (user unit) hasn't started because no one's logged in and linger isn't enabled
- `status.play.ris.hair` returns 502 until you SSH in

**Fix:** Add a prerequisite step in E-047 (or a small E-047a) that runs `loginctl enable-linger <user>` and verifies via `loginctl show-user <user> | grep Linger=yes`. Add to R-019 the explicit question: "Given `cloudflared` runs as a system service and project units run as user units, what's the boot ordering story and how do we keep the tunnel from sending traffic to ports nobody's listening on yet?" Document the answer (likely: user units should have `Restart=always` so they back-off-and-retry the few seconds it takes to come online; or use a `socket activation` pattern; or simply accept that the first ~30s after reboot may show 502s and the systemd Restart policy heals it). Add an actual reboot test (or `systemctl reboot` simulation) to E-049's success criteria, not just "restart the tunnel."

**2. The `paas register` workflow is not atomic and concurrent invocations are unsafe.** E-048 step 3 describes `paas register` as: (a) generate a systemd unit file, (b) run `systemctl --user daemon-reload`, (c) modify `~/.cloudflared/config.yml`, (d) restart `cloudflared`. Each of these is a separate filesystem/systemd mutation, and none of them are coordinated:

- If two `paas register` invocations run concurrently (user runs one in one terminal, an agent runs one in another), they can interleave reads/writes of `~/.cloudflared/config.yml` and one of them silently wins.
- If `paas register` crashes between (a) and (c), you have a phantom systemd unit with no tunnel ingress.
- If `paas register` crashes between (c) and (d), you have a stale config that `cloudflared` won't pick up until you remember to restart it.
- `systemctl --user restart cloudflared` is wrong — `cloudflared` is named in R-019 as running as a **system** service, not a user service. The CLI subcommand here is `systemctl restart cloudflared` (no `--user`), which means `paas` running as the user needs `sudo` rights for that specific operation, or polkit policy, or the cloudflared service needs to be reload-on-config-change via inotify.

E-048's success criterion "Tunnel config edits are atomic" is named but no mechanism is specified.

**Fix:** Specify the atomicity mechanism. The simplest pattern:
- Write `~/.cloudflared/config.yml.new`
- Validate it with `cloudflared tunnel ingress validate`
- `mv` it into place (atomic on POSIX)
- Signal cloudflared (`SIGHUP` for config reload, no full restart needed — `cloudflared` reloads ingress on SIGHUP since v2022.x)
- Wrap all of `paas register`/`remove` in a `flock` on `~/.cloudflared/.paas.lock` so concurrent invocations serialize

Decide explicitly: does `paas` need `sudo` for the cloudflared signal, or does the user's systemd setup grant the user permission to signal that specific service via polkit? Document the choice in R-019 and E-047.

**3. R-019 forecloses the alternatives comparison and risks anchoring on Cloudflare Tunnel for the wrong reasons.** R-019 says "Comparing Tunnel against alternatives (already decided: Tunnel)" is out of scope. But the decision was made in conversation without surveying alternatives. By May 2026, the relevant alternatives include:

- **Tailscale Funnel** — pretty close to one-command-per-project, no Cloudflare account needed at all, MagicDNS gives you `<host>.<tailnet>.ts.net`. The "only me" auth is just "is this device on my tailnet." For a strictly-personal PaaS, this is arguably the simpler primitive.
- **Tailscale Serve** (without Funnel) — same thing but only reachable from your own devices. Probably the cleanest "phone-to-Hetzner" path if you don't need third-party-shareable links.
- **Caddy with Cloudflare DNS-01** — full TLS, no tunnel; needs port 443 open but that's not exotic. Pairs with `tailscale` for "only me" auth or with CF Access via JWT verification at the Caddy layer.
- **Pomerium / Authelia in front of nginx** — auth at the proxy, more configuration but no Cloudflare lock-in.

The user's framing ("Hetzner = personal/play, Cloudflare = public/production") arguably favors **NOT** putting personal-play traffic through Cloudflare at all — the framing creates a separation principle that this plan violates. If the personal side uses Cloudflare Tunnel + Access, then the personal side is also "on Cloudflare," which dilutes the clean dividing line.

**Fix:** Expand R-019 to include a one-section comparison of alternatives with a recommendation. The recommendation can still be Cloudflare Tunnel (with reasons), but the alternative survey makes the choice considered rather than inherited. Specifically include Tailscale Funnel/Serve as the leading alternative since it most cleanly satisfies the "personal-play" framing. If Tunnel is kept, document explicitly why (e.g., "the user already has a Cloudflare account; wildcard subdomain pattern is natural; CF Access UX is more polished than Tailscale's user-facing ACL surface").

### Important (should address, may not block)

**4. Cross-goal dependency wired with a circular feel.** E-049 (G-012) depends on E-048 AND E-051. E-051 (G-013) depends on E-050. E-051 explicitly says "Co-completes: E-049 (G-012's dogfood experiment — they share this deployment as the verification)." So:

- E-049 waits for E-051 to produce a deploy-ready artifact
- E-051 IS the deployment, using E-048's CLI
- Both experiments describe the same physical action (`paas register /path/to/status-dashboard` + verification)

This isn't a circular dependency in the technical sense (E-051 doesn't depend on E-049 — they're co-completing), but it's a duplicated experiment. Either:
- Merge E-049 and E-051 into a single experiment owned by one goal with `closes:` pointing at both goal exit criteria
- Make E-049 explicitly "the verification" and E-051 "the deploy mechanics" with clear ownership of which sub-step lives where
- Or drop E-049 entirely and have G-012's exit criterion be satisfied by E-051

As written, an agent claiming E-049 will look at E-051 and not know whether to wait, do half the work, or do all of it. Same in reverse.

**Fix:** Choose a model. My recommendation: drop E-049 as a separate experiment, expand E-051's success criteria to cover both goal-exit-criteria explicitly, and add a note to G-012's exit criteria pointing at E-051 as the closer.

**5. The `.local-dev.yaml` schema has silent gaps around port allocation, env-var handling, and secrets.** The schema in E-048 has the user specify `port: 4001` directly. Problems:

- **Port conflicts**: nothing detects "this port is already used by another `paas`-managed project, or by something else on the box (sshd, postgres, etc.)." First failure mode the user hits.
- **Port allocation**: requiring the user to pick a port is fine but having `paas list` show port collisions, OR having `port: auto` allocate from a reserved range, would prevent the most common error.
- **Env vars**: `env_file: .env` is documented as "optional; defaults to .env if present." But what if the project's `.env` has both runtime-needed values and secrets that shouldn't be exposed? What if the project needs an env var that lives in a Cloudflare Access service-token or a secret manager? The current scheme says "use a `.env` file" and stops there.
- **Secrets ownership**: G-012 says "CLI never writes secrets into systemd units directly" — good — but the systemd unit pointing `EnvironmentFile=` at `~/project/.env` means systemd reads the file with the user's permissions on startup, and any changes to `.env` require `systemctl --user restart paas-<name>`. The schema doesn't mention this or document how `.env` changes propagate.
- **Path resolution**: `working_dir: /home/claude/joe-hudson/status-dashboard` is absolute, but `env_file: .env` is relative to what? Working dir? The yaml's location? Underspecified.

**Fix:** Tighten the schema in E-048:
- Add a port-conflict check at `paas register` time (read all `paas-*.service` units, check `Environment=PORT=`, error if collision; also a quick `ss -tlnp` to catch non-paas conflicts).
- Document `env_file` as relative to `working_dir`.
- Document that `.env` changes require `paas restart <name>` (not automatic) and add `paas restart` as a subcommand (currently the user has to do `paas down` + `paas up`).
- Add a one-line explainer that secrets stay in `.env` (gitignored) and never enter the systemd unit, so `paas list` and `journalctl` are safe to share.

**6. R-019 doesn't ask the right questions about the user-side dashboard work.** A predictable outcome of R-019 is "Cloudflare Tunnel + Access setup requires several actions in the Cloudflare dashboard that the user (not an agent) must do" — likely including: creating the Tunnel, creating the Access application, configuring the SSO IDP, possibly mapping the wildcard hostname. If R-019 finds this (it will), E-047 cannot proceed until a REQ is filed and the user does the dashboard work.

R-019's question list mentions the user but doesn't include "what's the minimum set of user-side dashboard actions needed before `cloudflared tunnel create` works." The experiment chain doesn't have a checkpoint for "REQ filed and resolved" before E-047 starts. The goal lists `[[REQ-003]]` in Resources, but REQ-003 is currently filed under G-010 (for E-046's Cloudflare deploy) and is about API tokens, not Tunnel/Access. The G-012 plan is reusing the REQ-003 reference but the REQ doesn't cover G-012's needs.

**Fix:**
- Add to R-019's scope an explicit "user-side dashboard prerequisites checklist" deliverable.
- Either rename/extend REQ-003 to cover both E-046 and E-047, or file a new REQ (REQ-004) when R-019 confirms the user-action set.
- Add `depends_on: REQ-XXX` to E-047's frontmatter pointing to the right REQ, and don't let E-047 start until it's filed-and-resolved.

**7. The "tunnel + ingress reload on SIGHUP" assumption needs verification.** E-048's blast radius says "Restarts `cloudflared` system service on each registration change (brief downtime — sub-second)." Two problems:

- A `systemctl restart` is heavier than a `kill -HUP` and incurs the tunnel's reconnect time (usually a few seconds, sometimes ~30s in flaky network conditions). Calling it "sub-second" is optimistic.
- If `cloudflared` is run via `cloudflared service install`, the service file may not be set up to handle `SIGHUP` for config reload — some versions of cloudflared treat config changes on signals as no-ops and require full restart.

This matters because: every `paas register` causes a tunnel reconnect = any in-flight connection to ANY project gets dropped. If the user has the dashboard open on their phone while registering a new project, the dashboard request drops. Annoying but not catastrophic — until the user is mid-chat with the coach on `coach.play.ris.hair` and registers an unrelated project.

**Fix:** Confirm in R-019 whether `cloudflared` supports SIGHUP-reload (it does as of recent versions, but document the threshold). If yes, use SIGHUP instead of full restart. If no, document the brief-interruption tradeoff honestly in `paas/README.md` and add to E-048 a note that bulk registrations should be done in a single transaction (read all `.local-dev.yaml`s, write config once, restart once).

**8. No experiment validates Next.js dev-mode HMR behind the tunnel.** E-048 says "a Next.js project to ensure the Next.js dev server works behind the tunnel (HMR / WebSockets)." Good. But this is just one bullet in the test ramp — the experiment's success criteria only require "the Next.js dev mode test confirms HMR works through the tunnel (no errors in the browser console; live edits propagate)." No specifics:

- WebSocket upgrade through Cloudflare Access — Access intercepts WS handshakes; some auth flows interact poorly with WS. Cloudflare has known issues with long-lived WS through Access in past versions.
- Next.js's HMR specifically uses `ws://` to `localhost:<port>/_next/webpack-hmr` — does this work when the request is coming from `https://<sub>.play.ris.hair` (origin mismatch)?
- Streaming SSE for the coach chat — already exercised by E-046 on Cloudflare Pages, but the streaming-via-Tunnel path is different. Cloudflare Tunnel has historically buffered some responses; verify or document.

**Fix:** Make these into separate, named success criteria in E-048 (or split out into a small E-048a "WebSocket/SSE/HMR verification"). Document the expected behavior so the implementer has falsifiable targets rather than "works."

**9. "Tunnel config is generated, not hand-edited" needs a guardrail.** The goal states this principle, but nothing enforces it. If the user (or an agent) hand-edits `~/.cloudflared/config.yml`, the next `paas register` clobbers their edits silently. This is the same trap as the playbook's "no user editing of mirrored content" issue from G-010's audit.

**Fix:** Add a header comment to the generated `config.yml` ("# Generated by paas. Do not edit. Run `paas <subcommand>` to modify.") and have `paas` verify the file has this header before overwriting (or back up the file with a timestamp if not, so user edits are recoverable).

### Minor (consider addressing)

**10. The "paas.play.ris.hair status page" nice-to-have is in tension with G-013's status dashboard.** Nice-to-have #1 in G-012 is a `paas.play.ris.hair` showing "what's running." G-013 is a dashboard for the whole project state. These could merge (G-013 includes a paas section), or stay separate. As-is they overlap. Worth a one-line decision: defer paas-page to v2 and let G-013 cover it.

**11. `paas list` output format isn't specified.** "Glance-readable" is the requirement, but no example output. Worth showing the intended output in E-048 (3-column table: subdomain | port | systemd-status; one row per project; URL on hover or in expanded view). Otherwise the implementer guesses.

**12. `paas logs <subdomain>` runs `journalctl --user -u paas-<unit> -f` — but Ctrl-C behavior, default tail length, and `--lines=N` aren't specified.** Trivial but worth a 3-line note ("paas logs defaults to last 100 lines + follow; pass `--no-follow` to print and exit; pass `-n N` for different line count").

**13. The `subdomain` field's validation rules aren't documented.** What characters are allowed? Reserved names? (`api`, `www`, `admin`, the literal string `paas`?) Length limit? A small validator in the CLI prevents the user from registering `subdomain: my project!` and getting a tunnel that won't resolve.

**14. The `mode: dev | built` field doesn't say how it affects behavior.** Presumably `dev` means `command: bun run dev` and `built` means `bun run start`, but if so, the field is redundant with `command`. Either drop `mode` and let `command` carry the meaning, or make `mode` do something specific (e.g., set systemd Restart policy differently, set NODE_ENV, set memory limit).

**15. Per-project resource limits (nice-to-have) might matter more than nice-to-have for v1.** A single Bun process that leaks memory can OOM the Hetzner box and kill everything. A modest `MemoryMax=512M` on every generated systemd unit is one line and prevents catastrophes. Worth promoting from nice-to-have to a default that the schema can override.

**16. `paas register` doesn't have a `--dry-run` mode.** First time you run it on a real project, you want to see what systemd unit it would generate and what tunnel-config diff it would apply, without actually doing it. Small addition, large debugging-confidence payoff.

## Playbook awareness

There is no PaaS-specific playbook (and creating one for a sample size of 1 would be premature). The two playbooks E-048 references — `coding-architecture` and `data-migrations` — are correctly judged "probably not relevant for v1." The CLI is a small enough surface that the Repository pattern would be over-engineering; the four-method shape is for data-domain objects, not for one-shot CLI subcommands.

The `cloudflare-deploy` playbook (created during E-046) is **not** referenced from G-012, but it should be. R-019 says "DNS does ris.hair need to be on Cloudflare nameservers" — the cloudflare-deploy playbook's "How to apply to a new project" section step 4 ("Provision Cloudflare side") covers exactly this, including the account-and-token chain that's already needed for G-010. Whether the same account + token combo can be reused for Tunnel + Access (probably yes, with a different token scope) is worth verifying in R-019.

What's missing: a playbook patch (or new playbook) noting that "for a personal-play deploy on Hetzner with `*.play.ris.hair`," the deployment recipe is `paas register .` — once G-012 is built, the playbook should be updated so future projects know the choice exists. That's post-G-012 work, but worth flagging now so it doesn't get forgotten when E-049 closes.

## Recommended Changes

In priority order, the concrete work items for a follow-up `wiki-next` pass:

1. **Add `loginctl enable-linger` prerequisite to E-047** (or split into E-047a), and add an actual reboot test (or `systemctl reboot` simulation) to E-049's success criteria. Address R-019 the "boot ordering between system cloudflared and user paas-*" question.

2. **Specify the atomicity mechanism for `paas register`** in E-048: tmpfile+validate+rename for `config.yml`, `flock` for serialization, SIGHUP (not restart) for cloudflared reload if supported. Decide and document whether `paas` needs sudo or polkit for the cloudflared signal.

3. **Expand R-019's scope to include an alternatives comparison** (Tailscale Funnel/Serve, Caddy+CF DNS-01, Pomerium, etc.). Recommendation can still be Cloudflare Tunnel but should be justified against the field. Pay particular attention to the user's "Hetzner=personal, Cloudflare=public" framing and whether the chosen primitive respects or violates it.

4. **Reconcile E-049 and E-051.** Recommend merging into one experiment (E-051) that closes both goal exit criteria, and dropping E-049 as a separate experiment. Update both goals' exit criteria to point at the single closer.

5. **Tighten `.local-dev.yaml` schema in E-048**: port conflict detection, port-auto allocation option, `env_file` path resolution rule, `paas restart` subcommand for env reloads, secrets-ownership documentation.

6. **Add user-side dashboard prerequisites to R-019's deliverables.** File a new REQ (or extend REQ-003) for G-012's specific needs (Tunnel + Access dashboard work, SSO IDP setup), and wire E-047's `depends_on` to it.

7. **Verify SIGHUP-reload behavior of `cloudflared` in R-019** and correct E-048's "sub-second downtime" claim.

8. **Add specific WebSocket / SSE / HMR success criteria to E-048**, not just "works through the tunnel."

9. **Add a "do not edit" header to generated `config.yml`** and a `paas` guardrail that detects/preserves hand edits.

10. **Decide on the paas-status-page nice-to-have**: defer to v2 and let G-013 cover it, OR keep but cross-link to G-013 so the overlap is acknowledged.

11. **Specify `paas list` output format** (3-column table example) so implementers don't guess.

12. **Promote per-project memory cap from nice-to-have to default** (`MemoryMax=512M` in the systemd unit template, overridable via `.local-dev.yaml`).

13. **Add `--dry-run` to `paas register`** for safe pre-flight inspection.

14. **Cross-link the `cloudflare-deploy` playbook from R-019** for the DNS + account-token overlap.

15. **Validate `subdomain` field** (allowed chars, length, reserved names) in the CLI's schema validator.

16. **Either drop `mode: dev | built`** as redundant with `command`, OR have it set NODE_ENV / Restart / memory-cap differently so it earns its keep.

17. **After G-012 lands**, add a one-section addendum to or successor of the `cloudflare-deploy` playbook documenting the personal-play deployment path (`paas register .`) so future projects know the option exists.

---

## Addressed (2026-05-24)

Done by `wiki-next-agent (R-019 expansion per G-012 audit)`. All 17 recommendations triaged and worked. Summary by rec ID:

- **#1 (linger + reboot test)** — Addressed in [[R-019]] new "Boot survival" section (linger explainer, boot-ordering analysis, mitigation options) AND in [[E-047]] (new pre-flight step #3-4 to enable+verify linger; new "Reboot survival" section with falsifiable success criteria — `systemctl reboot` simulation, 30-second recovery check on both cloudflared and user services).
- **#2 (atomicity)** — Addressed in [[R-019]] "SIGHUP reload behavior" section AND in [[E-048]] (every register/remove wrapped in `flock` on `cloudflared/.paas.lock`; tmpfile + `cloudflared tunnel ingress validate` + atomic `mv` for config edits; explicit Test 5 for concurrent registration; explicit Test 6 for crash-recovery).
- **#3 (alternatives comparison)** — Addressed in [[R-019]] new "Alternatives surveyed" table covering Tailscale Funnel (disqualified — no custom domain), Tailscale Serve (disqualified — private only, no subdomain), Caddy + CF DNS-01 (disqualified — requires public port 443), Pomerium/Authelia (disqualified — same), wireguard+Caddy (loses public addressability). Cloudflare Tunnel + Access retained with documented reasons. Explicit reflection on the "Hetzner=personal, Cloudflare=public" framing: framing preserved because it's about deployment target, not which CDN paths traffic crosses.
- **#4 (E-049/E-051 merger)** — Addressed: [[E-049]] marked `abandoned` with redirect note. [[E-051]] expanded with explicit `closes:` frontmatter pointing at both G-012 and G-013 exit criteria; method section split into "G-013 closure verification" and "G-012 closure verification" subsections; G-012's exit criteria updated to name E-051 as the closer (decision-log entry already recorded).
- **#5 (schema)** — Addressed in [[E-048]]: Zod schema with subdomain regex + reserved-name check, port range + `auto` option, `env_file` documented as relative to `working_dir`, `paas restart` added as a 4th subcommand (between up/down and list), secrets-ownership doc included in README criteria, `mode` made concrete (sets NODE_ENV) instead of being redundant with `command`.
- **#6 (REQ for G-012 prerequisites)** — Addressed: filed new [[REQ-004]] covering all G-012-specific Cloudflare prerequisites (Tunnel + DNS + Access token scope, Zero Trust activation, IDP setup, SSL coverage decision). [[E-047]] frontmatter `depends_on` changed from `R-019, REQ-003` to `R-019, REQ-004`. REQ-003 stays scoped to G-010's Workers deploy.
- **#7 (SIGHUP-reload behavior)** — Addressed in [[R-019]]: confirmed via research into cloudflared issues #301, #512, #1171 that **SIGHUP is a no-op for ingress reload as of May 2026**. `sudo systemctl restart cloudflared` is the canonical reload primitive. [[E-048]]'s "sub-second downtime" claim corrected to "2-30s tunnel reconnect, in-flight long-lived connections dropped." Honest documentation in `paas/README.md` flagged.
- **#8 (WS/SSE/HMR criteria)** — Addressed in [[E-048]] Tests 2-4: explicit falsifiable criteria for HMR (`[HMR] connected` log, live-edit propagation within 5s), streaming (real-time POST tokens, not buffered burst), and cross-subdomain CF Access cookie sharing.
- **#9 (config.yml generated header + guardrail)** — Addressed in [[E-048]] success criteria: generated `config.yml` has "Generated by paas. Do not hand-edit." header; CLI checks for this header before overwriting and backs up the file with a timestamp if absent.
- **#10 (paas-status nice-to-have)** — Addressed in [[G-012]] nice-to-haves: explicitly deferred to v2 with a cross-reference note to G-013 (which already covers the "what's running" surface as part of its dashboard sections).
- **#11 (paas list format)** — Addressed in [[E-048]] subcommand spec: 3-column table `SUBDOMAIN | PORT | STATUS` with `--verbose` for extra columns; example output shown.
- **#12 (paas logs flags)** — Addressed in [[E-048]] subcommand spec: default 100 lines + follow; `--no-follow` and `-n N` flags documented.
- **#13 (subdomain validation)** — Addressed in [[E-048]] schema: regex `^[a-z][a-z0-9-]{0,29}[a-z0-9]$`, reserved-name list (`www`, `api`, `admin`, `dashboard`, `paas`, `mail`, `ftp`, `ns`).
- **#14 (cross-link cloudflare-deploy playbook)** — Addressed in [[R-019]] new "Connection to the cloudflare-deploy playbook" section. Playbook expansion (audit rec #17) flagged for post-G-012 work via [[E-051]]'s method step #21.
- **#15 (memory cap default)** — Addressed in [[G-012]] nice-to-haves AND [[E-048]] schema: `MemoryMax=512M` shipped as default in the unit template, overridable via `.local-dev.yaml`'s `memory_max` field.
- **#16 (--dry-run)** — Addressed in [[E-048]] `paas register` subcommand spec AND in [[G-012]] nice-to-haves (promoted to v1 because of the safety-and-confidence payoff).
- **#17 (playbook addendum post-G-012)** — Captured as method step #21 in [[E-051]] (the closer experiment), to be done when E-051 runs. Not addressed now because the playbook addendum needs the actual `paas register .` workflow validated end-to-end before it can be authored honestly.

### Files modified or created in this addressing pass

- [[R-019]] — expanded with alternatives comparison, boot-survival/linger, SIGHUP-reload reality, user-side dashboard prerequisites checklist, cloudflare-deploy playbook cross-link, comprehensive implications-for-E-047/E-048/E-051 section
- [[E-047]] — added pre-flight linger step, sudoers entry step, symlink layout, generated-header on initial config, reboot-survival success criterion, updated `depends_on` to REQ-004
- [[E-048]] — rewrote with atomicity mechanism (flock + tmpfile + validate + mv + restart-with-poll), corrected reload-time claim (2-30s not sub-second), tightened schema (regex + reserved + port-auto + env_file resolution + memory_max), added `paas restart` subcommand and `paas register --dry-run`, expanded test ramp to 6 tests (added concurrent + crash-recovery), added README requirements
- [[E-049]] — marked `abandoned` with redirect note to E-051
- [[E-051]] — expanded with `closes:` frontmatter, dual G-012/G-013 closure verification sections, mobile real-world test, playbook addendum (audit rec #17) as method step #21
- [[G-012]] — exit criteria updated to name E-051 as the closer, decision-log entry added covering all the audit-driven changes, REQ-003 reference replaced with REQ-004, nice-to-haves updated per recs #10, #15, #16
- [[REQ-004]] — newly filed; covers Tunnel + DNS + Access dashboard prerequisites and API token scope; supersedes the (incorrect) reuse of REQ-003 in G-012

### Notes / disagreements

No disagreements with any recommendation. Audit was high quality and all 17 recs landed cleanly. One recommendation (rec #17 — playbook addendum) is deferred to E-051 execution rather than addressed now, because the addendum should reflect the validated `paas register .` workflow rather than a speculative one — captured as a method step in E-051 so it isn't forgotten.

The "boot ordering" rec (#1) surfaced a mitigation hierarchy (Restart=always + 2s; explicit After= + linger; cross-scope dependencies) — the wiki captured option 1 as the v1 default and documented the rest as escalation paths if the simple option proves insufficient. This is judgment, not disagreement.

