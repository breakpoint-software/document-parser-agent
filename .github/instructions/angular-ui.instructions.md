---
description: "Use when changing the Angular frontend, UI components, TypeScript, templates, forms, styling, accessibility, or frontend HTTP services in document-parser-ui."
applyTo: "document-parser-ui/**"
---

# Angular UI Instructions

## Architecture and TypeScript

- Use standalone components, feature-oriented organization, and lazy-loaded routes for independent areas.
- Keep business and data-access logic in services. Components must not call `HttpClient` directly or contain endpoint details.
- Keep components focused, prefer composition, and avoid business logic or complex expressions in templates.
- Before creating a component, service, directive, pipe, or utility, search for an existing equivalent.
- Use the Angular CLI to generate Angular artifacts when practical.
- Use strict TypeScript and explicit domain types. Do not use `any` or untyped objects.
- Keep shared contracts in `models/` or the established feature type file; do not duplicate contracts.
- Prefer Angular Signals for local synchronous state and `computed()` for derived state.
- Use RxJS for HTTP workflows, asynchronous streams, and event integrations. Follow the established subscription cleanup pattern.
- Declare explicit typed HTTP returns, payloads, path/query values, DTOs, and response envelopes. Map backend DTOs to domain models inside services when shapes differ.

## Templates and Forms

- Use modern Angular control flow (`@if`, `@for`, and `@switch`) in new or substantially changed templates when consistent with nearby code.
- Give every `@for` a stable tracking expression.
- Replace repeatedly invoked template methods with computed or prepared values when appropriate.
- Use Reactive Forms for non-trivial forms. Keep validation rules in the form model.
- Give every control a persistent accessible label; do not rely on placeholders as labels.
- Show validation messages after interaction or submission, not on untouched fields.
- Include disabled and loading states for asynchronous submissions.

## Components and Styling

- Use Angular Material for standard controls, Angular CDK for lower-level interaction behavior, and Tailwind CSS for layout and styling.
- Do not recreate Material controls without a concrete design requirement.
- Prefer Tailwind utilities and established design tokens over custom CSS, arbitrary colors, or arbitrary dimensions.
- Keep feature code within its feature. Put reusable presentation primitives, singleton services, and shared contracts in their established locations only when genuinely shared.
- Do not nest cards or turn ordinary page regions into decorative floating cards.
- Keep compact interfaces compact; do not use hero-scale typography in cards, forms, dashboards, or tool panels.

Use the shared `StatusBanner` for standard persistent feedback:

- Loading uses a spinner and `role="status"`; it is not dismissible by default.
- Error uses `role="alert"` and provides a dismiss action when persistent.
- Success uses `role="status"` and provides a dismiss action when persistent.
- Starting an operation clears stale success and error messages.
- Use Material Snackbar only for brief transient notifications.

## Responsive Actions and Spacing

- Use enabled Lucide Angular icons when a familiar icon exists.
- Below Tailwind's `sm` breakpoint, icon-and-text actions may show only the icon when context remains clear; restore text at `sm` and above.
- Give icon-only actions an accessible name and unfamiliar icons a tooltip.
- Keep mobile targets at least `40px` by `40px`, preferably `44px`, with stable dimensions.
- Do not hide text for primary authentication or high-risk actions when the icon is ambiguous.
- Use the `4px`, `8px`, `12px`, `16px`, `24px`, and `32px` spacing rhythm.
- Use `8px` from label to control, `4px` from control to hint/error, at least `16px` between controls, and at least `24px` between unrelated regions.
- Give cards and bordered panels explicit header and content padding.

## States and Accessibility

- Represent relevant loading, success, error, empty, disabled, hover, focus, and active states.
- Use skeletons for structured loading and inline spinners for submitting buttons where appropriate.
- Require confirmation for irreversible destructive actions. Use optimistic updates only for safe, reversible actions.
- Respect `prefers-reduced-motion`; keep purposeful transitions generally between `150ms` and `250ms`.
- Target WCAG 2.1 AA with semantic landmarks and native interactive elements.
- Preserve logical keyboard order and visible high-contrast focus indicators.
- Connect helper and error text with appropriate ARIA attributes.
- Mark decorative icons `aria-hidden="true"`; give functional images meaningful alt text and decorative images empty alt text.
- Maintain at least `4.5:1` contrast for normal text and `3:1` for large text and essential graphics.
- Ensure dialogs and menus manage focus, support Escape where appropriate, and restore focus on close.
- Inspect mobile and desktop layouts for alignment, overflow, overlap, and layout shifts.

## Validation

Run from `document-parser-ui/`:

```powershell
npm run build -- --configuration development
```

Run the production build when applicable. Its known initial-bundle budget failure is near `1.06 MB` against a `1.00 MB` error budget; report this separately from TypeScript or template failures and do not alter the budget unless requested.

```powershell
npm run build
```
