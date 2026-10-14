# Local native engine analysis

Pychess analysis can connect directly to
[pychess-external-engine](https://github.com/pychess/pychess-external-engine), a local
Python app managing native UCI engines and isolated rules validation. The browser
receives streamed evaluations from the user's computer. Pychess uses its existing
application; no extra Heroku process or public broker is required. Engine-scoped
account tokens register connection metadata with the existing server and MongoDB.

End-user installation and pairing are documented in the companion project's
[README](https://github.com/pychess/pychess-external-engine) and
[usage guide](https://github.com/pychess/pychess-external-engine/blob/main/docs/installation.md).
Its [architecture](https://github.com/pychess/pychess-external-engine/blob/main/docs/architecture.md),
[protocol](https://github.com/pychess/pychess-external-engine/blob/main/docs/protocol.md),
[compatibility](https://github.com/pychess/pychess-external-engine/blob/main/docs/compatibility.md)
and [roadmap](https://github.com/pychess/pychess-external-engine/blob/main/docs/roadmap.md)
cover the application design and future enhancements.

## Integration ownership

| Frontend code | Responsibility |
| --- | --- |
| [Analysis controller](../client/analysis/analysisCtrl.ts) | Source selection, lifecycle, permissions, exact rules and evaluation delivery |
| [Search backend interface](../client/analysis/searchBackend.ts) | Shared start/stop/destroy and capability/status contract |
| [Browser backend](../client/analysis/browserSearchBackend.ts) | Existing WASM UCI search and stop/readiness barrier |
| [External backend](../client/analysis/externalSearchBackend.ts) | Paired HTTP, NDJSON decoding, request identity and cancellation |
| [External settings](../client/analysis/externalEngineSettings.ts) | Account engine discovery, selector, preferences, removal and status messages |
| [Registration API](../server/external_engine_api.py) | Private account registrations, renewal and removal; no analysis relay |
| [Rule payloads](../client/analysis/externalRules.ts) | Minimal inherited INI definitions and UTF-8 hashes |
| [Study rules](../client/study/variantRules.ts) | Immutable aliases for historical definitions and inherited bases |
| [Variant resolution](../client/variants.ts) | Public/resolved engine names, CWDA profiles and initial Embassy castling |

The companion repository owns HTTP pairing/admission, resource bounds, native
subprocesses and rules workers. Pychess owns page permissions, board/tree state,
engine choice and display. See [Engine-Capabilities.md](Engine-Capabilities.md) for
the separation between browser search, native search, rules replay, Fishnet and Practice.

## Pairing and lifecycle

Users create an engine token at `/account/engines`, configure the local app with it
and their chosen UCI executable, then select the registered engine by name in analysis
settings. Browser local-network permission remains required. There is no pairing
dialog or launch link. Engines and networks remain the user's responsibility.

The existing `bot_token` collection stores hashed account tokens with explicit engine
scopes, separate from BOT gameplay permission. `external_engine` stores expiring,
owner-only capabilities, loopback address and a separate local credential. Registration
is renewed every 30 seconds and expires after 90 seconds without renewal. Revocation,
removal or replacement stops the provider on its next renewal. Browser preferences
contain only source and registration ID; credentials remain in page memory. Account
API tokens are shown once during account setup and never enter the analysis frontend.
No secrets enter URLs, PGNs or Study data.

One tab owns the native engine. Moving between nodes, changing source, leaving a
chapter or closing a tab aborts the previous stream. A fresh request ID prevents
stale results from updating another position even when their first move remains legal.
A tab can retry within a short window for its own aborted search; another tab receives
an engine-busy status. Stop/drain and bounded subprocess recovery happen in the bridge.

Selecting the browser engine returns to WASM analysis; Remove deletes the account
registration. A bridge restart rotates its credential and updates its registration;
selecting the engine again or Retry fetches current credentials. Connection restoration
uses granted browser permission or a connection already established in the current
page session, rather than repeatedly prompting on reload. The registration API accepts
only loopback addresses and cannot choose native commands, files or engine options.

## Rules, moves and capabilities

Requests keep the initial FEN, complete history and current-position FEN. They carry
exact custom definitions/inheritance and their content hash. Historical Study aliases
change when a definition or ancestor changes, keeping browser replay and native search
on the selected snapshot. Embassy resolution uses the initial castling profile after
kings move and rights disappear.

Native scores are side-to-move relative, matching local display conventions. Extended
ranks, drops, promotions/demotions, gating and compound move tokens are preserved.
Existing PV/SAN/arrow displays handle transient results; external evaluations do not
become saved server analysis/advice.

External capability is independent of WASM `variantSupportedByFSF`. Every companion
package install includes both rules libraries. Alice search requires a configured
Alice engine/network and explicit adapter capabilities; it uses compact looking-glass
FEN and fixed rules without Chess960/custom Alice definitions.

## Permissions and verification

Keep ongoing-game, anti-cheat, Study computer/visibility and extension-owned search
gates in force. Practice retains its bounded browser searches. Two-board scheduling,
hidden-information policies and USI/UCCI need separate adapters before capability
can be advertised.

Frontend changes follow this repository's AGENTS.md and relevant testing/CSS/engine
skills. Run frontend gates plus browser checks for affected flows: PV navigation,
source changes, stale events, chapter/rules switches, competing tabs, cleanup,
re-pairing and permission denial. Use the companion project's
[development probes](https://github.com/pychess/pychess-external-engine/blob/main/docs/development.md)
with a local checkout and temporary database. Do not substitute a successful UCI
handshake or replay test for native search/UI verification.
