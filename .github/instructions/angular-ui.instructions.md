---

description: "Use when changing the Angular frontend, UI components, TypeScript, templates, forms, styling, accessibility, or frontend HTTP services in document-parser-ui."

## applyTo: "document-parser-ui/**"

# Document Parser UI Instructions

## Product UI Principles

This is a compact productivity application for configuring document-processing workspaces, extraction schemes, folders, and rules.

Prioritize:

* Information density over decorative whitespace.
* Clear grouping over excessive cards and borders.
* Alignment and visual rhythm over oversized controls.
* Practical productivity UI over marketing-style layouts.
* Fast scanning over visual decoration.
* Stable, predictable interfaces over dramatic interactions.

The application should feel like a professional desktop SaaS tool, not a landing page.

Do not introduce visual elements solely to make the interface feel more "modern" or "premium". Every border, card, section, icon, gap, and control must improve hierarchy, grouping, or usability.

---

# Layout and Page Structure

## Application Shell

Maintain a stable application shell:

* Persistent top navigation for global actions and account/workspace controls.
* Persistent sidebar for primary navigation.
* Main content aligned consistently across pages.
* Global actions belong in the top bar.
* Page-specific actions belong near the page title or relevant section.

Do not create a dashboard page that simply repeats navigation concepts already available elsewhere.

A page should have one clear primary purpose.

If the Dashboard only displays workspace configuration and rules, structure it as a useful workspace overview rather than a generic dashboard with decorative widgets.

---

## Content Width

Do not let normal application content expand indefinitely across wide screens.

Use a readable maximum content width where appropriate while preserving efficient use of available desktop space.

Avoid:

* Extremely wide empty regions.
* Controls stretched across the full viewport without a reason.
* Large content containers with sparse content.

Use grid or column layouts when multiple pieces of related information can be scanned more efficiently side by side.

---

# Visual Hierarchy

## Page Titles

Use one clear page title.

Page titles should:

* Identify the current location.
* Remain visually prominent.
* Not consume excessive vertical space.
* Align with the main content below.

Do not add unnecessary introductory text when the page purpose is already obvious.

---

## Section Hierarchy

Use a clear hierarchy:

1. Page
2. Major section
3. Section content
4. Individual controls or records

Do not give every level a card, border, background, and title.

Prefer grouping through:

* Spacing
* Alignment
* Section headers
* Subtle dividers
* Shared backgrounds only when needed

Avoid nested or stacked decorative cards.

---

# Spacing and Density

Use a consistent spacing system based primarily on:

* 4px
* 8px
* 12px
* 16px
* 24px
* 32px

Default application rhythm:

* 8px between tightly related elements.
* 12px between related controls.
* 16px between groups within the same region.
* 24px between distinct regions.
* 32px only between major page sections.

Do not create large vertical gaps unless they communicate a meaningful separation.

Before increasing spacing, first ask:

> Are these elements actually unrelated enough to require more separation?

If not, keep them visually grouped.

Compact productivity screens should generally feel dense enough to scan efficiently without feeling cramped.

---

# Cards and Panels

Do not automatically place every section inside a card.

Use a card or bordered panel only when it represents:

* A distinct data object.
* A configuration group.
* A meaningful independent region.
* A visually separable interactive surface.

Avoid large cards containing only a few lines of information with excessive empty space.

A panel should have intentional density.

For settings summaries:

* Use structured rows or a responsive grid.
* Keep labels and values visually associated.
* Avoid large blank areas below short content.
* Do not make metadata blocks look like oversized dashboard widgets.

---

# Alignment Rules

Alignment is a primary design requirement.

Related elements must share clear alignment lines.

Examples:

* Section titles align with their content.
* Search, filters, sorting, and primary actions align on the same control row.
* Table headers align with corresponding content.
* Labels and values follow a consistent column structure.
* Cards in the same visual group share consistent internal padding.

Do not independently position elements to "look okay".

Prefer a deliberate grid.

When reviewing UI changes, actively check:

* Left edges.
* Right edges.
* Baselines.
* Control heights.
* Internal padding.
* Spacing between rows.

---

# Toolbar and Action Layout

For collection pages such as Rules:

* Keep search, sorting, filtering, and primary creation actions in one compact toolbar when space allows.
* The primary action should be visually dominant.
* Secondary actions should not compete with the primary action.
* Search should not consume excessive width when the collection is small.
* Sorting and filtering controls should use predictable widths.
* Maintain consistent control heights.

Preferred order:

1. Search
2. Sort
3. Filters
4. Primary action

Do not scatter collection actions across multiple rows on desktop unless required by space.

On smaller screens, allow the toolbar to wrap intentionally rather than shrinking controls to unusable sizes.

---

# Data Tables and Lists

Use tables when users need to compare multiple records across consistent attributes.

Tables should prioritize scanability.

Requirements:

* Keep row height compact but comfortably interactive.
* Use clear header hierarchy.
* Align text consistently by content type.
* Keep action columns compact.
* Avoid excessive cell padding.
* Do not wrap simple values unnecessarily.
* Use truncation with accessible full-value access when needed.
* Keep destructive actions visually separated from common edit actions.

For row actions:

* Use familiar icons.
* Provide accessible labels.
* Provide tooltips when the meaning is not immediately obvious.
* Do not make action columns wider than necessary.

Status should be communicated consistently through:

* Icons
* Labels
* Color as secondary reinforcement

Do not rely only on color.

---

# Workspace and Settings Summaries

Workspace settings should be optimized for quick scanning.

Prefer a structured layout where each setting contains:

* A concise label.
* A clearly associated value.
* Optional secondary description only when necessary.

For desktop layouts, related settings may use multiple columns.

Do not create unnecessary vertical stacking when horizontal space is available.

However, do not force unrelated information into the same row merely to fill space.

When a setting has a title, state, and description, keep those elements visually grouped and closer to each other than to the next setting.

---

# Typography

Typography should support hierarchy without wasting vertical space.

Use:

* Clear page titles.
* Moderate section titles.
* Compact labels.
* Readable body text.
* Subtle secondary metadata.

Do not use hero-scale typography inside application screens.

Do not use large typography to compensate for weak hierarchy.

Prefer spacing, weight, grouping, and alignment before increasing font sizes.

---

# Angular Architecture and TypeScript

* Use standalone components, feature-oriented organization, and lazy-loaded routes for independent areas.
* Keep business and data-access logic in services.
* Components must not call `HttpClient` directly or contain endpoint details.
* Keep components focused and prefer composition.
* Avoid business logic or complex expressions in templates.
* Before creating a component, service, directive, pipe, or utility, search for an existing equivalent.
* Use the Angular CLI to generate Angular artifacts when practical.
* Use strict TypeScript and explicit domain types.
* Do not use `any` or untyped objects.
* Keep shared contracts in `models/` or the established feature type location.
* Do not duplicate contracts.
* Prefer Angular Signals for local synchronous state.
* Use `computed()` for derived state.
* Use RxJS for HTTP workflows, asynchronous streams, and event integrations.
* Follow the established subscription cleanup pattern.
* Declare explicit typed HTTP returns, payloads, path/query values, DTOs, and response envelopes.
* Map backend DTOs to domain models inside services when shapes differ.

---

# Templates and Forms

* Use modern Angular control flow (`@if`, `@for`, and `@switch`) in new or substantially changed templates when consistent with nearby code.
* Give every `@for` a stable tracking expression.
* Replace repeatedly invoked template methods with computed or prepared values when appropriate.
* Use Reactive Forms for non-trivial forms.
* Keep validation rules in the form model.
* Give every control a persistent accessible label.
* Do not rely on placeholders as labels.
* Show validation messages after interaction or submission, not on untouched fields.
* Include disabled and loading states for asynchronous submissions.

---

# Components and Styling

* Use Angular Material for standard controls.
* Use Angular CDK for lower-level interaction behavior.
* Use Tailwind CSS for layout and styling.
* Do not recreate Material controls without a concrete design requirement.
* Prefer Tailwind utilities and established design tokens over custom CSS.
* Avoid arbitrary colors and arbitrary dimensions.
* Keep feature code within its feature.
* Put reusable presentation primitives, singleton services, and shared contracts in established shared locations only when genuinely shared.
* Do not nest cards without a strong structural reason.
* Do not turn ordinary page regions into decorative floating cards.
* Keep compact interfaces compact.

When changing an existing screen, preserve the existing visual system unless the task explicitly requires a redesign.

Do not introduce a different design language into one isolated page.

---

# Icons and Actions

* Use enabled Lucide Angular icons when a familiar icon exists.
* Prefer icons for common compact actions such as edit, delete, upload, search, filter, and sort.
* Do not use an icon and text when text adds no clarity and space is limited.
* Do not use icon-only controls for ambiguous or high-risk actions.
* Give icon-only actions an accessible name.
* Give unfamiliar icons a tooltip.

Below Tailwind's `sm` breakpoint:

* Icon-and-text actions may show only the icon when context remains clear.
* Restore text at `sm` and above.
* Do not hide text for primary authentication or high-risk actions when the icon is ambiguous.

---

# Responsive Design

Design desktop layouts intentionally. Do not treat desktop as a stretched mobile layout.

For responsive behavior:

* Preserve hierarchy.
* Preserve grouping.
* Avoid horizontal overflow.
* Avoid awkward control wrapping.
* Allow toolbars to reflow intentionally.
* Stack settings only when the available width requires it.
* Keep touch targets at least 40px by 40px and preferably 44px.
* Inspect mobile and desktop layouts for alignment, overflow, overlap, and layout shifts.

Do not solve responsiveness by simply reducing font sizes or hiding important information.

---

# Feedback and States

Use the shared `StatusBanner` for standard persistent feedback:

* Loading uses a spinner and `role="status"` and is not dismissible by default.
* Error uses `role="alert"` and provides a dismiss action when persistent.
* Success uses `role="status"` and provides a dismiss action when persistent.
* Starting an operation clears stale success and error messages.

Use Material Snackbar only for brief transient notifications.

Represent relevant:

* Loading
* Success
* Error
* Empty
* Disabled
* Hover
* Focus
* Active

Use skeletons for structured loading.

Use inline spinners for submitting buttons where appropriate.

Require confirmation for irreversible destructive actions.

Use optimistic updates only for safe, reversible actions.

---

# Accessibility

Target WCAG 2.1 AA.

* Use semantic landmarks and native interactive elements.
* Preserve logical keyboard order.
* Maintain visible high-contrast focus indicators.
* Connect helper and error text with appropriate ARIA attributes.
* Mark decorative icons with `aria-hidden="true"`.
* Give functional images meaningful alt text.
* Give decorative images empty alt text.
* Maintain at least 4.5:1 contrast for normal text.
* Maintain at least 3:1 contrast for large text and essential graphics.
* Ensure dialogs and menus manage focus.
* Support Escape where appropriate.
* Restore focus when dialogs and menus close.
* Respect `prefers-reduced-motion`.
* Keep purposeful transitions generally between 150ms and 250ms.

---

# UI Review Before Finishing

Before completing a frontend change, review the result as a UX/UI QA pass.

Check:

1. Is the page purpose immediately clear?
2. Is there unnecessary whitespace?
3. Are related elements closer together than unrelated elements?
4. Are alignment lines consistent?
5. Are controls consistently sized?
6. Is the primary action obvious?
7. Are there unnecessary cards or borders?
8. Does the page feel like a productivity application rather than a landing page?
9. Is information easy to scan?
10. Does the interface remain compact without feeling crowded?
11. Are desktop and mobile layouts intentionally designed?
12. Are loading, empty, error, disabled, hover, and focus states represented where relevant?

If a change creates a visually larger or more spacious interface without improving usability, prefer the more compact solution.

---

# Validation

Run from `document-parser-ui/`:

```powershell
npm run build -- --configuration development
```

Run the production build when applicable:

```powershell
npm run build
```

The known initial-bundle budget failure is near `1.06 MB` against a `1.00 MB` error budget.

Report this separately from TypeScript, template, or implementation failures.

Do not alter the bundle budget unless explicitly requested.
