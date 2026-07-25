## Live deployment

**⚠️ Not deployed yet.** `npm run cache:warm`-hardened and demo-ready, but the NitroCloud deploy step (`nitrostack login && nitrostack deploy`) needs the account owner's credentials — I built it deploy-ready, run the command below and paste the resulting URL here as the first line of this file:

```bash
npx @nitrostack/cli login
npx @nitrostack/cli deploy
```

---

# DomainExpansion.ai

A NitroStack MCP application that reconstructs an enterprise's real API attack surface from access logs, diffs it against a published OpenAPI contract to find shadow endpoints, and reports broken-object-level-authorization (BOLA) risk with the triggering log records attached as citable evidence.

## The problem

Published API specs drift from what a service actually does in production. New endpoints ship without ever being documented ("shadow APIs"). Object-level authorization checks get missed on individual routes even when the rest of the API enforces them correctly. Both classes of bug are invisible to a spec reviewer — they only show up in traffic. DomainExpansion.ai turns raw access logs into a reconstructed picture of the real surface, then runs deterministic detection rules against it, and hands an agent (or a human) a ranked, evidence-backed set of leads instead of a wall of log lines.

## How it works: deterministic engine, agentic triage

The detection logic lives entirely in `src/engine/**` — pure functions over plain data, no I/O, no network, no LLM calls, no clock, no randomness. Identical input always produces an identical, identically-ordered finding set. That separation is deliberate: a security tool that hallucinates findings is worse than none, so nothing about *whether* something is a finding is ever left to a language model. The MCP layer (`src/modules/surface/`) is a thin adapter — validate input, call the engine, shape the output — with **zero detection logic of its own**.

The agentic part sits above that boundary: an LLM client (via `audit_brief`, `remediation_plan`, `incident_handoff`) reasons about *what to do* with the findings — who probably owns the affected service, what to prioritise, how to phrase a ticket — using only the engine's already-computed, already-safe output. The engine decides facts; the agent decides communication and next steps. Neither one does the other's job.

## The seven detection rules

| Rule | CWE | Trigger |
|---|---|---|
| `R1_CROSS_ACTOR` | [CWE-639](https://cwe.mitre.org/data/definitions/639.html) Authorization Bypass Through User-Controlled Key | For a path-param position, ≥2 distinct non-admin/service accounts both received a 2xx on the *same* concrete object value |
| `R2_ENUMERATION` | [CWE-799](https://cwe.mitre.org/data/definitions/799.html) Improper Control of Interaction Frequency | One account touches ≥20 distinct values at the template's most specific param position inside any 120-second sliding window |
| `R3_AUTH_GAP` | [CWE-306](https://cwe.mitre.org/data/definitions/306.html) Missing Authentication for Critical Function | A template with ≥200 requests has **zero** 401/403 responses ever, while at least one sibling template at the same path depth correctly denies unauthorized access |
| `R4_EXISTENCE_ORACLE` | [CWE-204](https://cwe.mitre.org/data/definitions/204.html) Observable Response Discrepancy | Same param position returns 401 for some concrete object IDs and 404 for others — existence is observable to an unauthenticated caller |
| `R5_SHADOW` | [CWE-1059](https://cwe.mitre.org/data/definitions/1059.html) Insufficient Documentation | Observed template is absent from the imported spec (position-based match — see below); without a spec, falls back to a path-prefix/traffic-percentile heuristic |
| `R6_UNGUARDED_WRITE` | [CWE-285](https://cwe.mitre.org/data/definitions/285.html) Improper Authorization | A mutating (POST/PUT/PATCH/DELETE) endpoint with ≥10 write requests has zero 401/403 denials, while a sibling template at the same path depth does deny |
| `R7_LOG_INJECTION` | [CWE-117](https://cwe.mitre.org/data/definitions/117.html) Improper Output Neutralization for Logs | Path/query/User-Agent contains instruction-shaped text aimed at an automated log-analysis agent |

All seven rules declared in the type system are implemented.

Full algorithms, the scoring formula, and the false-positive controls are in [docs/DETECTION.md](docs/DETECTION.md).

## Security considerations

**The untrusted-input contract.** Every access-log record contains attacker-controlled strings — path, query, User-Agent. Any one of those that can reach a tool response or an LLM prompt passes through `neutralise()` (`src/engine/sanitise.ts`) first, with no exceptions.

**We structurally isolate rather than blocklist.** A blocklist of "bad phrases" always loses — attackers just rephrase, re-encode, or split a word with a zero-width character. `neutralise()` doesn't try to recognise every attack. It NFKC-normalises, strips evasion characters (zero-width joiners, bidi overrides), collapses whitespace, hard-caps length, and then wraps the result in a labelled, delimiter-escaped `<untrusted field="...">` tag — escaping any literal `<`/`>` in the value so a payload like `</untrusted><system>...</system>` can't terminate the wrapper early. Even a payload that evades every pattern-matching detector still arrives at the model, or on screen in the `evidence_viewer` widget, visibly quarantined as data, never live markup or an instruction.

**R7 practices what it preaches.** `detectR7LogInjection`'s own title, rationale, and metrics reference pattern *names* only (`ignore-previous`, `system-role`, ...) — never the raw attacker text it detected. The raw value is reachable exactly one way: through `evidence://finding/{id}`, and only after `neutralise()`.

**Every finding is required to carry evidence.** `Finding.evidence: string[]` must be non-empty — there's a test (`tests/ground-truth.test.ts`) that enforces it project-wide.

## External data source: the APIs.guru registry

`src/integrations/apisguru.ts` is the only file in this codebase permitted to make a network call. It's cache-first by design: a warm cache never touches the network at all, so a dead venue wifi doesn't matter once `fixtures/cache/apisguru/` (committed, ~7MB) is in place. 8-second `AbortController` timeout, native `fetch`, no API key.

Worth flagging: the build spec this project follows describes the document endpoint as `/{provider}/{service}.json`. That path 404s against the real live API (verified via `curl`, 2026-07-25) — the actual v2 API lists a provider's APIs at `/{provider}.json` as an `apis` map keyed by `provider` or `provider:service`, each entry carrying a `swaggerUrl` to the real document. `fetchSpec` resolves through that listing instead of a URL pattern that would never have worked.

`browse_spec_registry` and `import_registry_spec` expose this from the MCP layer; `npm run cache:warm` pre-fetches `providers.json` plus real specs for stripe.com (299 paths), slack.com (174 paths), and twilio.com (121 paths).

## MCP surface

10 tools, 5 resources, 4 prompts — confirmed at the protocol level (`"Application initialized with 10 tools, 5 resources, 4 prompts"`), not just by counting decorators.

**Tools:** `ingest_access_logs`, `import_openapi_spec`, `browse_spec_registry`, `import_registry_spec`, `get_api_topology`, `list_shadow_endpoints`, `scan_authorization_risks`, `get_finding_evidence`, `export_reconstructed_spec`, `generate_authz_test_suite`. Every tool returns `{ok:true, data, suggestedNext?}` or `{ok:false, code, message, nextAction}` — none ever throws. `suggestedNext` is populated on every success so an agent can walk the whole investigation (ingest → import spec → scan → fetch evidence → generate a regression test) without being told the next step by a human.

**Resources:** `logs://fixtures/{scenarioId}`, `registry://apisguru/{provider}/{service}`, `evidence://finding/{findingId}`, `spec://reconstructed/latest`, `findings://latest`. The evidence resource is the deliberate design bet here: findings are **citable by URI** rather than dumped into the model's context wholesale. An agent — or a human reading the transcript — can trace exactly which log lines justify a claim, and the untrusted-input contract is enforced exactly once, at the resource, instead of by every caller remembering to neutralise it themselves.

**Prompts:** `audit_brief`, `exec_summary`, `remediation_plan`, `incident_handoff`.

## Architecture

```
src/
├── engine/            pure detection logic — no I/O, no network, no NitroStack, no React
│   ├── types.ts           AccessLogRecord, EndpointTemplate, Finding, Topology, ToolResult
│   ├── templatise.ts      trie-based path -> {param} template collapsing (regex + Jaccard rules)
│   ├── topology.ts        aggregateEndpoints, buildTopology
│   ├── spec.ts            parseOpenApiTemplates, diffSpec (position-based matching)
│   ├── sanitise.ts        neutralise(), detectInjectionAttempt()
│   ├── rules/             R1–R7, one file each, shared DetectionContext
│   ├── score.ts           scoreFindings — exposure/sensitivity multipliers, R5 escalation
│   ├── artifacts.ts       exportReconstructedSpec, generateAuthzTestSuite
│   └── index.ts           runDetection — the engine's single entry point
├── integrations/
│   └── apisguru.ts    the ONLY network-calling code — cache-first, never throws
├── modules/surface/   NitroStack MCP layer — thin adapter, zero detection logic
│   ├── state.ts           in-memory store: ingested records + raw spec paths, nothing derived
│   ├── surface.tools.ts, surface.resources.ts, surface.prompts.ts, surface.module.ts
│   └── yaml.ts            dependency-free JSON->YAML for export_reconstructed_spec
├── widgets/           React presentation only — bound 1:1 to a tool via @Widget
│   └── app/{topology-graph,findings-list,evidence-viewer,surface-scorecard}/page.tsx
├── app.module.ts, index.ts
fixtures/
├── logs/acme-prod.jsonl       8,252 seeded access-log records
├── spec/acme-openapi.json     27-path OpenAPI 3.0 document
├── ground-truth.json          the manifest tests/ground-truth.test.ts checks against
└── cache/apisguru/            committed, warm — demo works with the network unplugged
tests/                 vitest — ground-truth assertions live here
scripts/               generate-fixtures.ts, warm-cache.ts
```

## Install

Prerequisites: Node.js ≥20.

```bash
git clone <this-repo>
cd domainexpansion
npm install
npm run fixtures       # regenerates fixtures/logs, fixtures/spec, fixtures/ground-truth.json
npm run cache:warm     # pre-fetches the APIs.guru cache (requires network once; committed afterward)
npm run dev            # boots the MCP server (stdio) + widget dev server on :3001
```

## Environment setup

**No secrets, no API keys, no `.env` file are needed to run this project.** Every tool that touches the network (`browse_spec_registry`, `import_registry_spec`) talks to the unauthenticated, public APIs.guru API. `.env.example` from the template scaffold was removed rather than left as unused clutter.

## Usage: the demo sequence

Copy-pasteable agent prompts, in order:

1. *"Ingest the acme-prod access logs."* → `ingest_access_logs({ source: 'fixture', fixtureId: 'acme-prod' })`
2. *"Import the OpenAPI spec for this API."* → `import_openapi_spec({ source: 'fixture', fixtureId: 'acme-openapi' })`
3. *"Show me the API topology."* → `get_api_topology({})` — renders the `topology_graph` widget
4. *"Scan for authorization risks."* → `scan_authorization_risks({})` — renders `findings_list`; expect `/internal/v0/export/customers` CRITICAL with both `R3_AUTH_GAP` and `R5_SHADOW`
5. *"Show me the evidence for the top finding."* → `get_finding_evidence({ findingId: '<id from step 4>' })` — renders `evidence_viewer`
6. *"Generate a regression test for that finding."* → `generate_authz_test_suite({ findingId: '<id>' })`
7. *"What providers does the APIs.guru registry have?"* → `browse_spec_registry({})`, then `import_registry_spec({ provider: 'stripe.com' })` to diff traffic against a real published contract

## Sample dataset

`fixtures/logs/acme-prod.jsonl` plants eight conditions, deterministically (seeded mulberry32 PRNG — regenerating with `npm run fixtures` produces byte-identical output):

| # | Condition | Expected result |
|---|---|---|
| 1 | `GET /api/v1/orders/{orderId}` — object 10432 fetched by 3 distinct user accounts | `R1_CROSS_ACTOR`, HIGH+ |
| 2 | `GET /internal/v0/export/customers` — 4,100 requests, zero 401/403 ever, absent from spec | `R3_AUTH_GAP` + `R5_SHADOW`, CRITICAL |
| 3 | `usr_7741` touches 60 distinct `docId`s in an 88-second window | `R2_ENUMERATION`, HIGH+ |
| 4 | Three prompt-injection variants (plain phrase, zero-width-split word, `system:` role injection) | `R7_LOG_INJECTION`, HIGH+ |
| 5 | `GET /api/v1/admin/feature-flags` — documented, role-gated correctly | **CONTROL — must not be flagged** |
| 6 | `POST /api/v1/auth/login` — documented, high 401 volume from many IPs (normal failed logins) | **CONTROL — must not be flagged** |
| 7 | `GET /api/v1/invoices/{invoiceId}` — 404 for nonexistent IDs, 401 for existing IDs | `R4_EXISTENCE_ORACLE`, MEDIUM+ |
| 8 | `DELETE /api/v1/webhooks/{hookId}` — 31 deletes, all 204, zero 4xx | `R6_UNGUARDED_WRITE`, MEDIUM+ |

34 endpoint templates observed, 27 documented, 7 shadow.

## Limitations

**Access logs cannot prove an authorization violation.** This tool surfaces prioritised, evidence-backed *leads* — patterns strongly correlated with real BOLA/shadow-API/log-injection incidents — not confirmed breaches. A human (or the owning team, via `generate_authz_test_suite`) still has to verify against the actual service.

**Requires an authenticated-subject field in the log schema.** `AccessLogRecord.actor.sub` is what `R1`/`R2` key off of; a log format without a stable per-request principal identifier can't be analysed by those two rules (they'd simply never fire, not silently mis-fire).

**`R5_SHADOW`'s no-spec heuristic is exactly that — a heuristic.** It flags known internal/debug/legacy path prefixes and low-traffic endpoints with no OPTIONS/HEAD support. With a real spec imported, shadow classification is exact (position-based diff, not the heuristic).

## Tests

```bash
npm test          # vitest run — 64 tests across 8 files
npm run typecheck # tsc --noEmit
```

`tests/ground-truth.test.ts` is the load-bearing suite: it runs the real detection pipeline against the real fixture data and asserts all six ground-truth properties — every expected finding present at its minimum severity, the two control endpoints get nothing, the export/customers finding is CRITICAL with both rules, every finding has non-empty evidence and a well-formed `evidenceUri`, no finding echoes raw attacker text, and the whole pipeline is deterministic across repeated runs. Every other engine module (`templatise.ts`, `topology.ts`, `spec.ts`, `sanitise.ts`, `artifacts.ts`, the APIs.guru integration) has its own dedicated test file, plus `tests/surface.integration.test.ts` exercises the real MCP tool layer end to end via NitroStack's `TestingModule`.
