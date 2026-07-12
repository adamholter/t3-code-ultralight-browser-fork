# Security

## Supported versions

The latest commit on `main` is supported while the project is pre-1.0.

## Reporting

Please report vulnerabilities privately through GitHub's security advisory flow rather than a public issue.

## Trust boundary

The bridge intentionally exposes local Codex capabilities to a browser UI. It binds to loopback and rejects non-local browser origins by default. Do not expose it on a public network without adding authentication, TLS, origin policy, and a deliberate permission model.

The complete-chat iframe accepts imperative host commands only from its actual parent window and an origin permitted by the bridge. Loopback parents are trusted by default; non-loopback and opaque parents require an exact `--allow-origin` entry. Granting an origin allows its pages to ask the user's local Codex to act, whether through the headless client or the complete-chat controller, so allow only origins the user controls.
