# Local external engine analysis

## Status and tracking

Design agreed on 2026-10-13. Phase 2 is complete: the standalone project serves paired
native UCI analysis with isolated rules admission, exact custom definitions, and
bounded process/search cleanup. Chromium and Edge passed native HTTP streaming and
abort/tab-close checks from the deployed HTTPS page. Phase 3 representative compatibility coverage
and Pychess frontend integration are complete. The browser engine now uses a
search backend interface and paired external-engine controls. Study snapshots, bridge restarts and optional Alice support pass. Clean-install
checks and release documentation are next.

Chromium transport and permission allow/deny are verified against the deployed HTTPS
analysis page. Firefox passed the headed check after the user allowed access; its
denial check remains open. Microsoft Edge passed the automated checks including
denial. Linux WebKit rejects HTTP loopback, and Safari is unavailable on Ubuntu;
a real macOS check remains pending. The initial protocol is
specified in the standalone project's `docs/protocol.md`; browser evidence and
reproduction steps are in its `docs/browser-compatibility.md`.

The standalone Python project lives at `~/pychess-external-engine`. This document
tracks both that application's implementation and its integration with Pychess.
Keep implementation in the standalone project and frontend changes in this repository.

Mark a checklist item complete only after its acceptance checks pass. Record the
relevant commit, tests, and any remaining limitation in the progress log below.
An installed rules library or a successful engine handshake alone does not prove
that analysis works for a variant.

## Goal and hosting constraint

Let users analyse positions on the Pychess website with native engines running on
their own computers, using the existing evaluation, PV, and board displays.

The Python bridge and engine both run locally. Pychess continues to use its existing
single Heroku dyno: this feature requires no extra hosted Python process, public
broker, MongoDB collection, or account API token. The browser sends analysis requests
directly to the local application; engine output does not pass through Heroku.

The first release targets ordinary single-board analysis with a compatible UCI
engine. The design must accommodate custom Fairy-Stockfish rules and additional
engine adapters without promising universal engine coverage.

## Architecture

```text
Heroku: existing Pychess application
    |
    | serves analysis page and existing position/rules data
    v
User's browser: Pychess analysis controller
    |
    | paired, cross-origin HTTP requests to a loopback address
    | newline-delimited JSON responses
    v
User's computer: one Python application
    - local HTTP API and pairing
    - engine capabilities and search lifecycle
    - pyffish position/history/PV validation
    - UCI subprocess adapter
    |
    | stdin/stdout
    v
User's native engine: Fairy-Stockfish or another compatible engine
```

Combine the responsibilities of Lichess's broker and provider into one local
application. There is no need for provider work polling, public engine registration,
or a queue routing jobs across machines. Start with one engine process and serialize
searches. Define explicit ownership for simultaneous tabs rather than letting them
silently replace each other's work.

Proposed package layout, to be created during implementation:

```text
src/pychess_external_engine/
    cli.py           # Local executable/configuration and application startup
    app.py           # aiohttp routes, pairing, and streamed responses
    protocol.py      # Versioned request/result/error schemas
    uci.py           # Handshake, capabilities, options, and output parsing
    search.py        # Serialized searches, cancellation, and process lifecycle
    rules.py         # pyffish validation and exact variant definitions
tests/
```

`pyffish` supplies rules and move handling. Its current API does not expose the
analysis search needed here; the native engine subprocess performs the search.
Python manages HTTP and process I/O with `asyncio`/`aiohttp`.

## User workflow

1. Install the local application and a supported native engine.
2. Configure the engine executable, optional networks, and resource limits locally.
3. Start the application; it displays its loopback address and a pairing token.
4. Select the external engine in Pychess and enter the local connection details.
5. Grant browser loopback/network permission if requested.
6. Analyse normally; moving to another position cancels the previous search.

Store connection preferences locally in the browser, scoped to the Pychess origin.
Keep credentials out of URLs, console logs, PGNs, Study data, and server requests.
Provide disconnect/forget controls and a way to rotate the local pairing token.
Account synchronization and remote-engine access are outside the first release.

## Browser connection and local access

Browser compatibility is the first implementation gate. Verify a real HTTPS page
connecting to loopback before building the full engine/UI flow.

- Bind to loopback only; do not expose the application to the LAN by default.
- Use a fixed, documented default port with a local configuration override.
- Allow explicitly configured Pychess origins, including development origins when
  requested. Validate the request origin and host and require a pairing token for
  engine operations; do not use wildcard CORS for authenticated requests.
- Answer CORS preflight requests without disclosing engine details or starting work.
- Implement the browser's applicable local-network access requirements. Permission
  denial must produce actionable connection UI rather than repeated prompts.
- Check actual served headers, including proxy CSP if present, and the existing
  COOP/COEP configuration. Preserve browser/WASM engine functionality.
- Verify Chrome/Edge, Firefox, and Safari. Document supported versions and any
  restrictions; do not assume that loopback HTTP works identically in all browsers.

Relevant browser references:

- [Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)
- [Locally delivered mixed resources](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content#loading_locally_delivered_mixed-resources)

A browser extension/native-messaging adapter is a possible later fallback if direct
loopback access cannot support an important browser. It is not a requirement for
the initial HTTP prototype. Record the prototype result before committing to the
final transport and endpoint details.

## Proposed protocol

Use a small versioned API with authenticated capability discovery and an analysis
endpoint returning newline-delimited JSON. Final route names and schemas belong
to phase 1; these are the required semantics.

An analysis request identifies:

- Protocol version, tab/session ID, and unique search/request ID.
- Display variant and resolved engine variant; explicit Chess960 mode.
- Initial FEN and the exact move history to the selected tree node, with a
  current-position FEN for correlation and validation.
- Custom rules and their SHA-256 hash when required, including inherited definitions.
- Requested Threads, Hash, MultiPV, and supported depth/time/node limits.

Use engine coordinate strings, preserving extended board ranks, fairy pieces,
drops, promotion/demotion suffixes, and compound moves. Do not deserialize moves
through a chess-only board library. The request's Chess960 mode and move/FEN
conventions must agree with the engine adapter and rules validator.

Stream explicit events for started, evaluation, completed, and error states.
Evaluation events carry the search ID, elapsed time, nodes, depth, MultiPV lines,
and cp/mate scores. Define scores as **side-to-move relative**, matching Pychess's
current local-analysis display, and make that convention part of the schema.
Do not copy Lichess's White-relative broker output into this path unchanged.

Reject invalid positions, histories, unsupported variants, and incompatible rules
before issuing `position`/`go`. Enforce request-size and resource limits locally.
Support engines lacking optional Threads, Hash, or variant options through
capability discovery and explicit adapter defaults.

Parse UCI `info` fields without depending on a single engine's field order.
Handle partial MultiPV updates, score bounds, terminal positions, and engine-specific
non-score information. Preserve valid extended move tokens and validate PV prefixes
with the appropriate rules backend before returning actionable moves.

## Search lifecycle

On navigation or engine selection changes, abort the old response and stop its
search. Disconnection and tab closure must also release engine work. Tag all results
with their originating search ID and ignore late output in the frontend even when
its first move happens to remain legal at the new position.

Drain the old search through `bestmove` before changing options or sending the next
`position`/`go`. Use bounded readiness/stop timeouts and restart a stuck subprocess.
Keep `ucinewgame` and hash reuse tied to deliberate session/rules transitions.
Define idle shutdown, engine crash, bridge restart, and reconnect behaviour.

Configure executable paths and engine-specific options locally. Browser requests
must not choose arbitrary commands, file paths, or shell arguments. Launch configured
executables with argument arrays. Load validated custom rules through controlled
engine input or application-managed files, and configure network paths locally.

## Variant and rules compatibility

External search capability is independent of browser search, rules replay, server
Fishnet analysis, and Practice capability. See
[Engine-Capabilities.md](Engine-Capabilities.md).

| Variant category | Planned treatment |
| --- | --- |
| Ordinary single-board Fairy-Stockfish variants | Initial implementation; discover actual engine and rules support |
| Site/custom Fairy-Stockfish variants | Supply exact definitions and inheritance chains, verify hashes, then discover capabilities |
| Chess960 and engine aliases | Resolve the same engine variant and notation conventions as Pychess |
| Alice | Optional configured Alice-capable engine and pinned `pyffish_alice` adapter; fixed rules, no Chess960 |
| Two-board variants | Later integration with Pychess's board scheduling and changing pocket state |
| Fog of War and Jieqi | Separate analysis policy and state model; no generic claim of meaningful search support |
| Native USI/UCCI engines | Later protocol/notation adapters; UCI support alone does not cover these engines |

Load custom definitions **before** querying the engine's supported variants. Pin
Study snapshots by content hash; never silently replace historical rules with the
current definition of the same name. Resolve engine aliases such as CWDA matchups
and Capablanca/Embassy castling consistently with the game and browser rules.

Keep rule registration controlled: `pyffish` has process-wide configuration. Use
bounded registration/lifetime management or replace an isolated rules worker when
needed, rather than accumulating arbitrary definitions forever. Validate incoming
FEN geometry/material and rules payloads before invoking native code, reusing the
existing Pychess admission rules as the reference.

## Pychess integration

Introduce a search backend interface for start, stop, destroy, capabilities, status,
and evaluation delivery. Adapt the existing browser engine first, then add the local
HTTP implementation. Continue using the existing score/PV/SAN/arrow displays.

Relevant integration points:

- [Analysis controller](../client/analysis/analysisCtrl.ts): engine lifecycle and evaluation delivery.
- [Analysis settings](../client/analysis/analysisSettings.ts): engine selection and connection controls.
- [Analysis context](../client/analysis/analysisContext.ts): page capabilities.
- [Analysis extensions](../client/analysis/analysisExtension.ts): Study visibility and computer-search permissions.
- [Engine variant resolution](../client/cgCtrl.ts): resolved variant used by rules and search.
- [FairyBoard](../server/fairy/fairy_board.py): engine aliases and alternate rules backends.
- [Study position validation](../server/study/engine.py): admission checks before native move generation.
- [Fishnet rules payloads](../server/fishnet.py): exact custom definitions and inheritance/hash conventions.
- [Two-board engine](../client/two-board/analysis/engine.ts): later board scheduling integration.

Preserve ongoing-game and anti-cheat restrictions, Study computer permissions,
concealed lesson content, and extension-owned searches. The external adapter must
not bypass these gates. Keep Practice on its existing backend until its bounded
search and shared-engine ownership requirements are explicitly supported and tested.
Keep transient external evaluations separate from saved server analysis/advice.

## Implementation checklist

### Phase 0: research and workspace

- [x] Trace registration, browser transport, broker, and UCI provider in Lichess.
- [x] Identify chess-specific variant/FEN/move/PV dependencies in the Rust broker.
- [x] Probe the Python provider against native Fairy-Stockfish for Shogi, Xiangqi,
  Grand Chess, and Orda; check returned best moves with `pyffish`.
- [x] Select one local Python application with no additional Heroku process.
- [x] Create `~/pychess-external-engine`, its initial README, and this tracking plan.

### Phase 1: prove browser transport and freeze the initial protocol

- [x] Build a minimal loopback HTTP prototype with pairing and a fake result stream.
- [x] Test HTTPS-to-loopback streaming, preflight, permission grant/denial, and
  abort/disconnect under Pychess's actual response headers.
- [x] Record browser/OS compatibility and any required header changes or fallback.
- [x] Choose the port, routes, protocol version, request/result schema, and score POV.
- [x] Define resource bounds, token lifecycle, and multi-tab ownership/busy behaviour.
- [x] Complete the headed Firefox permission allow check.
- [x] Complete the real installed Edge transport and permission allow/deny checks.
- [x] Decide the initial verified browser matrix: Chromium 154 and Edge 155 on Linux x86_64.
- [ ] Follow-up outside this release: Firefox native UI/denial and real Safari/macOS
  checks when available; evaluate a fallback before claiming Safari support.

Acceptance: a supported browser receives and cancels a paired local stream without
new Heroku infrastructure or breaking WASM analysis.

### Phase 2: local Python application and UCI lifecycle

- [x] Add package metadata, discovery CLI, configuration, license/attribution, and development checks.
- [x] Launch configured engines, discover options, and report actual capabilities.
- [x] Implement serialized searches, robust UCI parsing, MultiPV, and streaming events.
- [x] Handle controller stop/drain sequencing, deadlines, crashes, and idle shutdown.
- [x] Add fake-engine tests for lifecycle races and a real Fairy-Stockfish smoke test.
- [x] Bind the native controller to paired HTTP with production rules admission and
  verify actual HTTP disconnection/tab-close cleanup before accepting phase 2.

Acceptance: a paired client can search, cancel, and replace a position; late output
never becomes the next search's result, and engine failure releases resources.

### Phase 3: variant rules and exact custom definitions

- [x] Add `pyffish` position/history/PV validation with native admission bounds.
- [x] Load site/custom definitions and inherited bases before discovering engine variants.
- [x] Verify rules hashes, Study snapshots, Chess960, and resolved engine aliases.
- [x] Test extended ranks, drops, promotions/demotions, gating/compound moves, repetition,
  terminal positions, black-to-move scores, and unsupported-engine combinations.
- [x] Define rules-worker isolation/lifetime and explicit configuration mismatch errors.

Acceptance: representative single-board variants use matching rules throughout;
invalid or incompatible inputs fail before engine search.

### Phase 4: Pychess frontend integration

- [x] Introduce the search backend interface while retaining browser-engine behaviour.
- [x] Add paired local connection, engine selection, disconnect/forget, and status UI.
- [x] Deliver external events to existing evaluation/PV displays with request correlation.
- [x] Make external capability independent of `variantSupportedByFSF`.
- [x] Preserve anti-cheat, ongoing-game, Study, Practice, and concealed-content restrictions.
- [x] Test tree navigation, chapter/rules switches, multiple tabs, backend changes,
  bridge restarts, unsupported variants, and permission denial.
- [x] Run required frontend gates and browser checks; use the CSS skill if styling changes.

Acceptance: users can select a local native engine and analyse safely through the
normal single-board UI; the browser-engine path remains functional.

### Phase 5: packaging and first release

- [ ] Document installation, supported Python/OS/browser versions, pairing, engine
  configuration, custom rules, networks, resource limits, and troubleshooting.
- [ ] Verify installation in clean environments on the supported operating systems.
- [x] Publish a supported variant/engine matrix based on completed checks (standalone `docs/compatibility.md`).
- [ ] Complete release checks in both repositories and record versions/commit references.

Acceptance: another user can install, pair, analyse, and stop the application using
only the published instructions. Publishing/release is a separate authorized action.

### Phase 6: optional engine and workflow expansion

- [x] Add Alice engine/rules support with explicit capability reporting (requested for this goal).
- [ ] Adapt two-board scheduling and state correlation without claiming joint search
  from independent single-board evaluations.
- [ ] Evaluate hidden-information analysis policies and suitable engine support.
- [ ] Add USI/UCCI adapters and conversion tests if requested.
- [ ] Consider Practice bounded searches and browser-extension fallback if needed.

Acceptance: each addition has its own engine, rules, browser, and permission checks;
partial support remains visible rather than being inferred from variant names.

The user selected Alice as the only phase-6 addition for this goal. Two-board,
hidden-information and USI/UCCI expansion remains deferred; first-release work
continues alongside the Alice adapter.

## Verification policy

For bridge implementation, run its own Python format/lint/type checks and targeted
protocol, subprocess, and rules tests. Select supported Python versions in phase 2
based on `pyffish` wheel availability and test those versions in CI.

For Pychess implementation, follow `AGENTS.md` and the `pychess-testing` skill:
frontend changes require `yarn lint`, `yarn typecheck`, `yarn md`, and `yarn test`,
plus relevant browser verification. Server changes additionally require the Python
gates and targeted tests. Run full Node CI, including `yarn dev`, when doing full
release verification. Run tournament coverage only when affected.

Documentation-only updates require Markdown rendering/link checks and diff review;
they do not establish runtime compatibility or complete implementation phases.

## Progress log

| Date | Milestone | Evidence and limitations |
| --- | --- | --- |
| 2026-10-13 | Phase 0 research | Inspected local lila `4641264ccb`, lila-ws `89b1e88`, external-engine `d0eeb24`, and lila-engine `bfb00c1`. HTTP transport is independent of lila-ws. |
| 2026-10-13 | Native provider probe | Python provider plus Fairy-Stockfish `051026 LB`, NNUE disabled, depth 2: Shogi, Xiangqi, Grand Chess, and Orda best moves were legal according to `pyffish` 0.0.90. This is a shallow compatibility probe, not full protocol/browser/variant coverage. |
| 2026-10-13 | Capability discovery finding | Provider queried `UCI_Variant` before setting `VariantPath`, so Orda was searchable after loading rules but absent from its cached advertisement. Fix discovery order in the new adapter. |
| 2026-10-13 | Workspace and design | Created the separate project workspace and local-only plan. Implementation starts with the HTTPS-to-loopback prototype. |
| 2026-10-13 | Phase 1 transport prototype | Standalone commit `cd3adb3`: added `tools/transport_probe.py` and 10 transport/configuration tests. Pairing, exact origin/host checks, CORS/PNA preflights, request limits, disconnect cleanup, and exclusive stream ownership pass. Ruff format/lint and Pyrefly pass. Browser compatibility was not yet verified at this step. |
| 2026-10-13 | Phase 1 browser probe | Standalone commit `e3cfcd3`: Chromium 154.0.8037.57 on Linux passed paired capabilities, incorrect pairing, streamed fake evaluations, competing tabs, abort/tab-close cleanup, and permission denial from the deployed HTTPS analysis page. Existing COOP/COEP and SharedArrayBuffer remain available; no header changes. Browser-engine search itself is not yet tested. Firefox 155 needs manual Allow; Linux WebKit 26.6 rejects HTTP loopback. Edge/Safari remain unverified. |
| 2026-10-13 | Phase 1 protocol decisions | Standalone `docs/protocol.md` defines port 9670, v1 authenticated capabilities/analysis routes, side-to-move scores, exact custom rules/history correlation, resource bounds, per-start token rotation, and one-search ownership. Full engine semantics remain phase-2/3 work. |
| 2026-10-13 | Firefox headed transport | User supplied the successful Firefox 155.0 Linux report after choosing Allow: streaming, competing-tab rejection, abort/tab-close cleanup, and two released streams passed. Recorded verbatim in the standalone project's `docs/results/firefox-linux-2026-10-13.json`. Denial remains pending. The user authorized continuing with native engine implementation. |
| 2026-10-13 | Edge transport | Installed Microsoft Edge 155.0.4283.45 on Linux passed the same deployed-HTTPS transport and permission allow/deny checks as Chromium. Report saved in `docs/results/edge-linux-2026-10-13.json`. User confirmed Safari is unavailable on Ubuntu and authorized continuing; Safari/macOS remains outside verified coverage. |
| 2026-10-13 | Phase 2 package/discovery | Added package metadata and lockfile, local-only engine configuration, AGPL license/attribution, discovery CLI, and subprocess cleanup. 20 unit tests pass on Python 3.13.13; Ruff format/lint and Pyrefly pass. Real Fairy-Stockfish `051026 LB` discovery loaded the site INI before re-advertising variants, including Orda. Streamed search is not yet implemented. |
| 2026-10-13 | Phase 2 search controller | 35 tests pass, including real depth-2 MultiPV-2 searches for Chess, Shogi, Xiangqi, and Grand Chess with legal best moves/PV prefixes. Request identities, partial/bounded output, delayed stop output, hung-stop process replacement, cancellation, competing ownership, terminal handling, wall-clock limits, and idle-close races are covered. Ruff format/lint and Pyrefly pass. Controller requires a rules backend; the native HTTP binding awaits production rules admission. |
| 2026-10-13 | Phase 3 isolated rules admission | 49 tests pass on Python 3.13.13, including the native search smoke tests. One rules subprocess per search bounds registration lifetime and isolates native faults. Exact hashes, inherited snapshots, geometry/material guards, legal history/PV prefixes, mandatory pocket promotion state, optional chess promotion markers, Chess960, capturable en passant, Shogi promotions, ten-rank coordinates and S-Chess gating are covered. Ruff format/lint and Pyrefly pass. Native acceptance/loading of exact custom definitions and the HTTP binding remain open. |
| 2026-10-13 | Phase 3 native custom rules | 53 tests pass, including exact definitions overriding a conflicting local INI, hash-change process replacement, same-hash reuse, inherited historical snapshots and recovery after rejection. Native diagnostic checking has bounded time/output and requires explicit acceptance; the pinned pyffish rule-name schema rejects names its parser would silently ignore. Original UTF-8 bytes are loaded before rediscovery. Ruff format/lint and Pyrefly pass. Engine-alias resolution, wider variant coverage and HTTP/frontend integration remain open. |
| 2026-10-13 | Phase 2 native HTTP acceptance | The installed CLI now starts the local API. 63 tests pass, including real HTTP searches for Chess, Shogi, Xiangqi and Grand Chess, invalid-position rejection before search, competing ownership, silent/hung-engine disconnection, crash recovery, shutdown and output-flood cleanup. Ruff format/lint and Pyrefly pass. Chromium 154 and Edge 155 passed native streaming, competing tabs, abort/tab-close cleanup and permission denial from the deployed HTTPS page; reports are recorded in the standalone docs. Frontend selection/display integration is not yet implemented. |
| 2026-10-13 | Phase 4 browser backend interface | Added start/stop/destroy, capabilities/status and evaluation delivery interfaces; adapted the existing browser UCI path with its stop/readiness barrier, NNUE options, history and permission gates. All 888 Node tests pass; lint, typecheck, Markdown generation and development build pass. A local Chromium check with a mock database verifies real WASM PV output, PV-click navigation/restart, toggle stop and retained cross-origin isolation. External pairing/source UI remains next. |
| 2026-10-13 | Phase 4 external transport adapter | Added paired loopback capability discovery, bounded NDJSON decoding, request epochs/IDs, resource ceilings, cancellation and bounded retries for a tab's own cleanup. Minimal INI chains include inherited snapshots and UTF-8 hashes. All 896 Node tests pass; lint, typecheck and Markdown generation pass. Tests cover fragmented data, delayed legal PVs after replacement, stale pairing, custom capability before registration, permission failure without retries, competing ownership and invalid scores. The adapter is not yet exposed by the analysis UI. |
| 2026-10-13 | Phase 4 paired external UI | Added source selection, token/address pairing, disconnect/forget, status messages, native engine naming and local-only connection preferences. Restoring a connection requires previously granted permission or a successful connection in the current page session. All 899 Node tests pass; lint, typecheck, Markdown generation and development build pass. Edge/Chromium UI checks cover native PV navigation, Black-to-move evaluation, competing tabs, tab-close cleanup, reconnect, forget and permission denial. CWDA uses its resolved profile with WASM search deliberately unavailable; Orda supplies exact custom definitions. Layout/focus and NNUE-control visibility pass at desktop/mobile sizes in light/dark themes after inspecting served stylesheets and computed styles. UI checks serve the local checkout through a synthetic HTTPS origin with a mock database; deployed-HTTPS transport was verified separately. Chapter switches, bridge restart, broader variants and release preparation remain open. |
| 2026-10-13 | Phase 3 castling profile | Capablanca/Capahouse now resolve Embassy castling from the initial FEN, preserving the engine identity after kings move and rights disappear. This matches the server and keeps root-history replay on the correct rules. All 901 Node tests pass; lint, typecheck, Markdown generation and development build pass. An Edge native UI probe with an E-file-king Capablanca FEN confirms the resolved `embassy` key, PV navigation, ownership, reconnect/forget and permission-denial behaviour. |
| 2026-10-13 | Study snapshot and ownership transitions | All 906 Node tests pass; lint, typecheck, Markdown generation and development build pass. Study rule chains now receive immutable client aliases, including aliased ancestors; changed parent rules change the child key. Candidate rules are prepared before mutating the active chapter. The live Edge probe switches Chess → Orda → two historical versions of one public name → earlier snapshot → Chess, retaining the tab ID and checking distinct/stable hashes plus the browser's actual pawn destinations. Practice and disabled computer permissions release native work and disable connection controls. Native action buttons now support keyboard focus and disabled semantics; corrected their Snabbdom selector order after a rendered regression exposed custom tags. Bridge restart and broader variant checks remain open. |

| 2026-10-13 | Optional Alice adapter | Added optional `pyffish-alice` 0.0.3 and locally configured Alice engine/options. Startup checks the advertised variant and a legal shallow search; per-adapter capability flags reject Alice custom rules and Chess960. One owner and one native process cover ordinary/Alice switching. Rules tests cover looking-glass FEN/history correlation, transfers, castling and promotion; native HTTP verifies Black-to-move PVs and Alice → Chess → Alice switching. Edge UI passes with browser search blocked and Alice-Stockfish 1.0 plus its Legacy Alice_v1.nnue network: evaluations, PV navigation, competing ownership, cleanup, reconnect/forget, permission denial, mobile/desktop light/dark styles. All 69 standalone Python tests and 907 Node tests pass; Ruff format/lint, Pyrefly and required frontend gates pass. Bad/incomplete Alice qualification reaps processes; per-adapter resource ceilings and rejection before search are covered. Wider first-release compatibility/restart checks and packaging remain open. |

| 2026-10-13 | Phase 3 compatibility acceptance | The repeatable native probe passes 14 representative cases at depth 2/MultiPV 2: Black-relative scores, Chess960 and Embassy castling, Shogi drop/promotion, Kyoto demotion, Janggi pass, ten-rank coordinates, promoted Crazyhouse captures and pockets, S-Chess gating, complete repetition history and terminal mate. Rules tests additionally normalize the extended PV tokens and reject lost pocket state. Missing variant, Chess960 or custom-definition engine options fail before `position`/`go`; a command-log regression proves repetition history is retained. Targeted rules/search tests, Ruff format/lint and Pyrefly pass. The standalone compatibility matrix links these receipts and the exact-rules/Study/Alice UI evidence; coverage remains representative rather than universal. |

| 2026-10-13 | Phase 4 restart and capability acceptance | Edge passes native bridge shutdown, process release, visible connection failure, rejection of the old token after restart, and a fresh search after entering the rotated token. The negative Alice UI check pairs to an ordinary bridge but keeps analysis disabled and acquires no search. Repeatable probes and reports are committed in the standalone project; Ruff format/lint and Pyrefly pass. Earlier frontend gates, Study/tree transitions, stale-request tests, browser/WASM checks, restrictions and computed-style checks remain passing evidence. Initial verified browsers are Chromium 154 and Edge 155 on Linux x86_64; Firefox native UI/denial and Safari/macOS are explicit follow-ups outside the verified release matrix. |

## Upstream references and reuse

- [Lichess external-engine](https://github.com/lichess-org/external-engine): Python provider; GPL-3.0.
- [Lichess lila-engine](https://github.com/lichess-org/lila-engine): hosted Rust broker; AGPL-3.0-or-later.
- [Lichess browser external adapter](https://github.com/lichess-org/lila/blob/master/ui/lib/src/ceval/engines/externalEngine.ts).
- [Fairy-Stockfish variant standards](https://fairy-stockfish.github.io/chess-variant-standards/).

Borrow the smallest useful lifecycle/parser/adapter pieces and preserve upstream
notices and attribution. The initial workspace contains documentation only; no
upstream implementation has been copied. Confirm license obligations when adding
code and distributing the Python application or engine binaries.
