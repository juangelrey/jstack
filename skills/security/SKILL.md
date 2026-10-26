---
name: security
description: Security checklist for code changes. Use when code touches authentication, authorization, sessions, user input, secrets or credentials, dependencies, file or network access, or when asked for a security review.
---

# Security

Apply to the change under review or being written. Discover the repo's own tooling and conventions; assume no stack.

## Boundaries

**Always**
- Validate and encode untrusted input at the boundary; use parameterized queries and safe APIs.
- Check authorization server-side on every request, per object.
- Keep secrets in env or a secret store, out of code, logs, errors, fixtures.
- Fail closed: deny on error or missing config.

**Ask first**: a human decides. While writing code, stop and ask (Implement blocks). While reviewing, report each as an `ASK` line: it does not fail the gate, but it makes the PR a one-way door, so a human merges it.
- New auth flows, roles, or permission changes.
- New dependencies, or major version bumps.
- Loosening a security control: CORS, CSP, TLS verification, a protected path.
- Storing new personal or sensitive data.

**Never**
- Commit secrets, keys, tokens, or real credentials.
- Build queries, commands, or paths by concatenating user input.
- Roll your own crypto, use MD5/SHA1 for security, or fast unsalted hashes for passwords.
- Trust client-side checks, or log sensitive data.
- Suppress an audit finding without a written reason.

## OWASP Top 10 (2025; use a newer edition if the repo cites one)

1. **Broken access control**: deny by default, enforce ownership, no IDOR, CORS allowlist. Includes SSRF: allowlist outbound targets, block internal address ranges.
2. **Security misconfiguration**: no default creds, debug off in prod, minimal permissions, security headers.
3. **Software supply chain failures**: see Dependencies; pinned CI actions, trusted registries, no unreviewed install or build scripts.
4. **Cryptographic failures**: TLS everywhere, vetted algorithms, nothing sensitive in URLs or logs.
5. **Injection**: SQL, OS command, template, XSS, and prompt injection into agents. Parameterize; escape for the output context; pass user text to models as data.
6. **Insecure design**: abuse cases considered, rate limits, explicit trust boundaries.
7. **Authentication failures**: no weak or default passwords, brute-force limits, MFA path.
8. **Software or data integrity failures**: verify lockfiles and signatures, no unsafe deserialization.
9. **Security logging and alerting failures**: log auth and access events, never secrets, resist log injection.
10. **Mishandling of exceptional conditions**: fail closed on errors, no stack traces or internals in responses, no error path that skips a control.

## Auth

- Authn: slow salted hash (argon2, bcrypt, scrypt); constant-time comparison; generic failure messages.
- Authz: least privilege; roles checked server-side; re-check on each sensitive action.
- Sessions: random IDs, rotate on login, expire, invalidate on logout; cookies `HttpOnly`, `Secure`, `SameSite`; CSRF protection for cookie auth.
- Tokens: short-lived; validate signature, issuer, audience, expiry.

## Secrets

- None in code, history, logs, error messages, client bundles, or fixtures.
- Load from env or a secret store; ship an example file with fake values.
- Rotate on exposure: a leaked secret is revoked, not just deleted.

## Dependencies

When the change adds, removes or upgrades a dependency, or touches a manifest or lockfile: discover the repo's audit tooling from its manifests, lockfiles, scripts and CI (a package manager's `audit`, a dedicated scanner) and run it. Rate by what the change introduces: a CRITICAL or HIGH advisory in a dependency the change adds or upgrades keeps its severity; advisories already present on the trunk are Notes. No audit tooling is a LOW note, never a block. Flag new dependencies that are unmaintained, unnecessary, or typosquat-like.

## Reporting

One line per finding: `SEVERITY file:line: problem. Fix: ...`. Severity: CRITICAL, HIGH, MEDIUM, LOW, plus `ASK` for Ask first items. CRITICAL and HIGH block. Report only what you verified in the code.
