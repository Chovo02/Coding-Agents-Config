---
name: api-security
description: Review or write API and service code for security problems using OWASP Top 10:2025 and ASVS 5.0 Level 1. Use when building or reviewing HTTP APIs, authentication, sessions, authorization, input validation, file uploads, model/artifact loading (deserialization), secrets, or when asked for a security review of a diff.
---

# API security

Apply when writing or reviewing code that exposes or consumes an API. For a review, follow the workflow; do not
report pattern matches, report reachable problems.

## Review workflow

1. **Map entry points and trust boundaries:** routes/handlers, headers and cookies, uploads, webhooks, queue
   consumers, CLI args, third-party API responses. Note where authentication and authorization are enforced
   (often central middleware or dependencies, not per route).
2. **Sweep** the OWASP categories below for what the code touches; trace each candidate from an entry point to
   the sink.
3. **Triage every candidate** with the four questions, drop what fails them:
   1. Is the input really attacker-controlled (request data, upload, webhook, third-party response), not a
      constant or trusted config?
   2. Is the sink reachable with it, or does validation, an allowlist, an ORM or a framework control already
      sit in between? Look for auth middleware before flagging missing authorization.
   3. What is the blast radius: who can trigger it, what do they get, which trust boundary is crossed?
   4. Can the attacker do every step from their position? If not, it is "Needs verification", not High.
4. **Report** highest severity first, one block per finding:

```
[SEVERITY] Title (CWE-###, OWASP A##:2025)
Location:   path/to/file.py:LINE
Path:       <entry point> -> <hops> -> <sink>
Impact:     who can trigger it, what they get, which boundary it crosses
Fix:        the concrete change (snippet if not obvious)
Confidence: Confirmed | Likely | Needs verification (say what you could not see)
```

Severity: **Critical** unauthenticated RCE / auth bypass / mass data exposure; **High** authenticated
exploitation crossing a boundary (IDOR across tenants, SQLi behind login); **Medium** unusual preconditions or
own-data impact; **Low** defense-in-depth with no demonstrated path; **Info** hardening, say it is not a
vulnerability. If nothing is exploitable, say so; do not pad the report.

## OWASP Top 10:2025 (use these names and numbers, not the 2021 ones)

| # | Category | Key prevention |
|---|---|---|
| A01 | Broken Access Control (includes SSRF) | Deny by default, enforce server-side, verify object ownership |
| A02 | Security Misconfiguration | Harden config, disable defaults, no debug in prod |
| A03 | Software Supply Chain Failures | Lock versions, verify integrity, audit dependencies |
| A04 | Cryptographic Failures | TLS 1.2+, AES-256-GCM, Argon2/bcrypt for passwords |
| A05 | Injection | Parameterized queries/ORM, validate input, no shell/eval on user data |
| A06 | Insecure Design | Threat-model, rate limit, design the control in |
| A07 | Authentication Failures | MFA where possible, breached-password check, secure sessions |
| A08 | Software or Data Integrity Failures | Safe deserialization, signed artifacts and packages |
| A09 | Security Logging and Alerting Failures | Log security events, structured, alert |
| A10 | Mishandling of Exceptional Conditions | Fail closed, hide internals, log with context |

## ASVS 5.0 Level 1 essentials for APIs (cite 5.0 IDs only; 4.0 IDs do not map)

- Passwords ≥ 8 chars (15+ recommended), no composition rules, block the top common passwords, rate-limit
  logins against credential stuffing, no default accounts (6.2.1, 6.2.4, 6.2.5, 6.3.1, 6.3.2).
- Session/token from a CSPRNG with ≥ 128 bits entropy, new token on (re)authentication, unusable after
  logout/expiry (7.2.3, 7.2.4, 7.4.1).
- Function-level and data-level access restricted to explicit permissions, enforced in a trusted service
  layer (8.2.1, 8.2.2, 8.3.1).
- Parameterized queries/ORM, parameterized OS calls, context-appropriate output encoding, no `eval`
  (1.2.1–1.2.5, 1.3.2); allowlist input validation at a trusted layer (2.2.1, 2.2.2).
- TLS 1.2+ with trusted certificates; approved ciphers only (12.1.1, 12.2.1, 11.3.1); no sensitive data in
  URLs or query strings (14.2.1).
- Logging starts at Level 2: auth attempts, failed authorization, security events, generic error to the user
  with detail in the log (16.3.x, 16.5.1).

## API and ML-serving checks (original, not from the upstream skill)

- **Object-level authorization:** every endpoint that takes an id checks the caller may access *that* object
  (IDOR is the commonest High). Check list/search endpoints and bulk operations too.
- **Mass assignment:** do not bind request bodies straight to models; use explicit schemas (e.g. Pydantic) with
  allowed fields only.
- **Limits:** request size, upload size and type, pagination caps, rate limits and timeouts, including
  inference endpoints (a large or crafted input can exhaust CPU/GPU/memory).
- **Deserialization:** never unpickle or `torch.load` untrusted files; prefer safe formats (e.g. safetensors,
  or `torch.load(..., weights_only=True)`), and verify the source/hash of model artifacts you download.
- **Secrets:** none in code, images, logs or error messages; tracker (MLflow/ClearML) and cloud credentials via
  runtime environment or a secret store; check `.env` is ignored and not copied into images.
- **CORS and headers:** no `*` origin with credentials; security headers on browser-facing responses.
- **Errors and logs:** generic messages to clients, no stack traces or internals; do not log tokens, passwords
  or personal data from request payloads.
- **Dependencies:** lockfile committed, known-vulnerable packages reviewed (`pip-audit` / `uv` tooling),
  base images pinned.
