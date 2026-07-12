# Security

## Supported versions

The latest commit on `main` is supported while the project is pre-1.0.

## Reporting

Please report vulnerabilities privately through GitHub's security advisory flow rather than a public issue.

## Trust boundary

The bridge intentionally exposes local Codex capabilities to a browser UI. It binds to loopback and rejects non-local browser origins by default. Do not expose it on a public network without adding authentication, TLS, origin policy, and a deliberate permission model.
