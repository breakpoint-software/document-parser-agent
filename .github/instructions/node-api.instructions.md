---
description: "Use when changing the Express Node.js API, routes, controllers, middleware, Firebase persistence, Google integrations, authentication, or authorization in document-parser-api."
applyTo: "document-parser-api/**"
---

# Node API Instructions

- Preserve the established separation among routes, authorization middleware, controllers, and service configuration.
- Validate route parameters and request bodies before persistence.
- Return consistent JSON envelopes and appropriate HTTP status codes.
- Treat the Firestore document ID as the canonical resource ID; stored payload fields must not override it during serialization.
- Enforce workspace ownership through the existing authentication and authorization middleware.
- Keep Firebase collection paths and legacy migration behavior consistent with existing controllers.
- Keep secrets and environment-specific configuration out of source control and responses.
- Handle integration errors explicitly without exposing technical details to clients.
- Do not couple application code, tests, scripts, or documentation to `seed/`.

## Validation

Run from `document-parser-api/`:

```powershell
node --check server.js
Get-ChildItem src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Run configured npm test or lint scripts when they exist. Do not invent commands absent from `package.json`.
