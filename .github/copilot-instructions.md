# Document Parser Development Instructions

This repository contains an Angular frontend, a Node.js API, and a Python document-processing service. Preserve existing behavior and architecture, keep changes focused, and follow the conventions of the project being modified.

## Repository Structure

* `document-parser-ui/`: Angular, TypeScript, Angular Material, Angular CDK, Tailwind CSS, RxJS, Signals, and Reactive Forms.
* `document-parser-api/`: Node.js and Express API integrating Firebase and Google services.
* `document-parser/`: Python document-processing and orchestration service.
* `seed/`: Isolated seed scripts and seed data. Application code, tests, package scripts, and documentation must not depend on seed files.

Do not introduce frameworks, component libraries, state-management libraries, or npm/Python dependencies unless the task clearly requires them.

## General Engineering Rules

* Read the owning implementation and nearby call sites before editing.
* Prefer the repository's existing patterns and shared abstractions.
* Fix root causes and avoid unrelated refactors.
* Keep public contracts backward compatible unless the task explicitly changes them.
* Never hardcode secrets, credentials, tokens, or environment-specific API URLs.
* Handle errors explicitly and do not expose technical details to end users.
* Do not generate new test files unless explicitly requested.
* Run applicable existing tests and builds after changes. Never remove or weaken tests to make validation pass.

## Final Verification

Before completing a change, confirm as applicable:

* Modified code compiles and has no new diagnostics.
* Existing relevant tests pass, or pre-existing/unrelated failures are clearly reported.
* No unnecessary dependency, seed-file coupling, or unrelated refactor was introduced.
