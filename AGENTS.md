# Content budget for every build and edit

Build the smallest useful interface that performs the requested X, not a flood of information about X. Put the working object first. Default to no explanatory preamble; at most one short paragraph when needed. Build reports, not forms: an app that explains, investigates or analyzes is a read-only report of findings with sources, with no inputs, pickers, presets or what-if calculators; add controls only when the operator asks or human input is the product's purpose. Include only labels, results and feedback needed for the requested capability. No unsolicited summaries, tutorials, timelines, statistics cards, glossaries, implications, recommendations or extra tabs. Completion means the requested behavior works, not that its topic is comprehensively explained. Replace or delete redundant content; do not hide it in accordions. Preserve saved data and source evidence through existing APIs. An explicit surface list is the complete budget. Research briefs use one paragraph and one overview image when requested; System architecture and Ranked findings tabs only when requested, with sources beside claims.

# App favicon

Use Favicon Generator directly when an icon is needed. Keep and commit existing artwork. Automatic generation on app creation is retired.


# App purpose metadata

Keep a short factual sentence about what this app does in excessivecode.json.description. Put the searchable purpose in the first 120 characters. Include recognized old names only when true. Keep it current when the app scope changes. This is metadata; do not add new UI text for it.

# App sign-in

This app requires sign-in by default. Keep the auth manifest and the signed-in page boundary. Only make the app public when the operator explicitly asks. Excessive Code registered this app with AuthReturn using the app slug, private signup, and the canonical managed agent identity. Read https://authreturn.com/agent-guide.md before integration. Use AuthReturn.init() in the browser; verify app-scoped bearer JWTs on the server before returning private data or accepting changes. Hiding HTML is not data access control. Keep private page content hidden until login is restored. Preserve any explicitly public service APIs and shared assets as separate access contracts. Before shipping, prove signed-out access cannot read private data and signed-in access works.

# Database default

Use PostgreSQL for shared persistent application data. Give this app its own database and least-privilege role, keep connection credentials in the secrets-master service secret, and use bounded connections and short transactions. Use another service only through its network API. Static or transient apps need no database. Keep SQLite for explicitly requested embedded/offline storage or an existing store until a separate migration preserves its data and verifies cutover. Do not silently fall back to SQLite when PostgreSQL is unavailable.

# Python dependency releases

When adding Python, commit a complete hash-locked requirements.lock and set deployment.python to {"requirements":"requirements.lock","python":"/usr/bin/python3.10"}. Generate the lock with uv pip compile --generate-hashes. Use the installed system Python version. Excessive Code builds isolated release environments from a protected uv hardlink cache; deployments reject unlocked Python environments. Keep require_locked_python enabled.

