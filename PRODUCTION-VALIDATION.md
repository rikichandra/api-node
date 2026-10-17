# API v1 validation — 2026-10-16

Delivery scope: single-instance deployment with durable local SQLite and authenticated asynchronous job APIs. Public hosting and multi-replica deployment are not part of this local implementation.

Verified in this Windows workspace, Node.js 24.15.0:

- 22 automated checks passed. API checks use a controlled matcher to verify authentication, tenant ownership, strict request validation, idempotency, paging, row order, partial errors, cancellation, deadlines, CAPTCHA circuit breaker, single-instance lock, quotas, graceful restart and recovery of persisted running/checkpoint state. Docs asset tests confirm public documentation does not bypass job authentication or expose keys.
- Actual HTTP submission through the API fetched a real business from Google Maps, reached succeeded, and returned coordinates. Temporary smoke outputs remain in storage; the requested cleanup was blocked by the execution policy.
- Browser QA verified documentation on desktop/mobile, language tabs, playground submit/status/results, input validation, key clearing, no local/session storage and no JavaScript errors. This UI test used a controlled matcher and did not query Google.
- Postman CLI readiness and unauthenticated-request checks: four assertions passed, with event reporting disabled.
- Served OpenAPI matched the versioned contract exactly.
- SQLite online backup was created and checked with integrity_check = ok.
- Full npm audit and production-only npm audit: zero reported vulnerabilities at verification time. The development ExcelJS uuid dependency was patched via a scoped override and its write/read compatibility checked.
- Compose YAML and the vendored seccomp profile parse successfully. Loopback port binding and a restrictive seccomp default action were verified.

Not established by these checks:

- Docker/Linux build and execution; Docker is unavailable on this host.
- Sustained-load capacity, availability SLA, completeness of Google results or guaranteed customer identity.
- Exactly-once browser activity across hard interruption. Committed result rows are preserved; an in-flight browser lookup may be repeated.

Before external production traffic, deploy one instance on the target server, verify browser sandbox startup, persistent volume ownership, HTTPS, backup/restore and a small live matching job. Monitor memory, disk, queue length, job errors and upstream blocking. See API-README.md for operational defaults and limits.
