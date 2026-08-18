<div align="center">

# Adam Salicki's Portfolio

A minimal, mobile-first portfolio for web, infrastructure, and hardware projects.

[![Astro](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white)](https://astro.build)
[![Bun](https://img.shields.io/badge/Bun-runtime-14151A?logo=bun&logoColor=white)](https://bun.sh)
[![Live site](https://img.shields.io/badge/Live-adamsalicki.pages.dev-08665F)](https://adamsalicki.pages.dev)

</div>

## Runtime architecture

Astro emits static HTML and scoped CSS; interactive component scripts are bundled
as native ES modules. There are no client framework components, `client:*`
directives, or hydration runtime. Inline JavaScript is reserved for the theme
bootstrap and page loader because both must run before deferred modules and before
the first paint. All other behavior is layered onto server-rendered markup through
stable `data-*` contracts.

The initial DOM already contains the correct first-project state, link targets,
ARIA relationships, image dimensions, and fallback hero text. Browser modules
enhance that state rather than constructing the page. This keeps layout independent
of JavaScript execution and avoids a client-rendering boundary.

## Boot sequence

1. The inline bootstrap in `Layout.astro` resolves a stored theme, falling back to
   `prefers-color-scheme`, and writes `data-theme` before rendering can flash the
   wrong palette. On pages that opt into the loader, it also sets `data-page-loading`
   and temporarily switches scroll restoration to manual on reload.
2. The portfolio page's `PageLoader.astro` marks the document busy and advances
   toward 92% while waiting for `load`. After both `load` and the 650 ms minimum
   duration, it interpolates to 100%, runs the accent curtain, and removes itself.
   The 404 page opts out so recovery content paints immediately. Transition
   listeners have timeout fallbacks, and the layout has an independent six-second
   escape hatch.
3. Deferred component modules initialize against the complete DOM. The kinetic
   custom element replaces its visual fallback, while navigation, deck, gallery,
   heading, and footer controllers attach to existing elements.

## Rendering and interaction internals

| System | Implementation details |
| --- | --- |
| Theme transition | The navbar serializes theme changes and computes a circle radius from the toggle to the farthest viewport corner. `document.startViewTransition()` performs the reveal when available; otherwise a temporary cover uses the Web Animations API. A `site-theme-change` event invalidates consumers such as the kinetic renderer. |
| Kinetic heading | `<kinetic-text>` owns four canvases: a text mask, warped frame, chromatic tint buffer, and final composite. `ResizeObserver` controls backing-store dimensions, DPR is capped on mobile/coarse pointers, and rendering is restricted to tiles intersecting measured glyph bounds. `IntersectionObserver` and `visibilitychange` stop the animation off-screen or in a hidden document. |
| Project deck | Astro precomputes each card's translation, rotation, and stacking layer as CSS custom properties. The controller maintains one clamped active index and synchronizes `inert`, `aria-hidden`, `aria-current`, control disabled states, position text, and the live region in one update pass. |
| Deck gestures | Pointer movement is direction-locked after a 7 px threshold. Horizontal drag is capped at 110 px, receives resistance at either boundary, and changes cards after 48 px. Pointer capture keeps the gesture coherent; the following click is suppressed so a completed swipe cannot activate a card link. |
| Image gallery | Frames form a vertical scroll-snap track inside the fixed media viewport. Controls call `scrollTo()` using frame offsets, while passive scroll events schedule a single control-state calculation per animation frame. An observer threshold sequence arms the delayed scroll hint only when enough of the gallery is visible. |
| Magnetic interaction | The layout mounts `MagneticHover.astro` once to initialize `magnetic-hover.js` independently of visible components. The repeat-safe controller treats `[data-magnetic]` as the boundary and `[data-magnetic-target]` as the transformed element. Strength, travel limit, and activation media query are declarative. Pointer coordinates update targets; rendering is coalesced through `requestAnimationFrame` and reset when capability or motion preferences change. |
| Privacy dialog | A native modal `<dialog>` supplies focus containment and Escape semantics. Opening and closing are explicit states; a close requested during opening reverses the active animations. The morph transform is derived from the trigger and dialog rectangles, while reduced motion and animation failures fall back to immediate native operations. |
| Scramble headings | A shared observer starts interval-driven substitution only while a heading intersects the viewport. Timers live in a `WeakMap`, so re-entry, exit, and runtime motion-preference changes can restore canonical text without retaining detached elements. |

## Project and image pipeline

`src/config/projects.js` imports local assets as Astro `ImageMetadata`. Each record
keeps its summary, role, challenge, and outcome alongside its media and technology
stack. `Projects.astro` passes that content to `ProjectCard.astro`, which renders the
impact fields as a semantic definition list and emits images with intrinsic
dimensions before `project-deck.js` adds interaction. Technology names are resolved
against the Simple Icons map at build time; interface controls remain Lucide Astro
components and add no icon runtime.

The card media viewport is 16:9, but `object-fit: contain` means non-16:9 sources
use only part of its width. Responsive image sizing therefore applies:

```text
containScale = min(1, sourceWidth * 9 / (sourceHeight * 16))
```

`project-layout.ts` applies that scale to a conservative card-slot estimate. It
derives the deck reserve from the project count, subtracts the shared page gutters
and card borders, and applies the desktop media track's `17 / 24` share. The
generated `sizes` value has mobile, tablet, fluid desktop, and 72 rem-capped desktop
branches, so changing the number of projects updates both the visible deck spacing
and image request size. A platform scrollbar gutter can make the rendered slot
slightly narrower; not subtracting a fixed scrollbar width avoids underfetching on
overlay-scrollbar platforms. Astro generates candidates at 240, 320, 400, 480, 560,
640, 750, 828, 1080, 1280, and 1668 px, filtered against the source width.

## Integration invariants

- The initial ARIA and CSS state in `Projects.astro` must remain equivalent to the
  first `updateDeck()` pass; otherwise controls can shift state when the module runs.
- Project and gallery scripts use `data-*` selectors as their public boundary.
  Renaming visual classes is safe only where a script does not query that class.
- No Astro `ClientRouter` is installed, so controllers initialize once when their
  module executes. Adding client-side page transitions requires restoring an
  Astro navigation lifecycle hook or an equivalent teardown/reinitialization path.
- `Projects.astro` and `ProjectCard.astro` share the project-count geometry in
  `project-layout.ts`. The browser suite verifies the reserve, generated `sizes`,
  gutters, and rendered media-element width across mobile, tablet, and desktop
  breakpoints.
- Theme-aware canvas output depends on the `site-theme-change` event and the shared
  tokens in `src/styles/global.css`; changing theme state without dispatching the
  event leaves the existing canvas composite stale.
- Reduced-motion handling is functional, not cosmetic: loaders exit directly,
  galleries use immediate scrolling, heading substitution stops, and continuous
  canvas animation resolves to a static frame.
- `bun run check` validates the hand-maintained sitemap, robots file, response
  headers, web manifest, favicon/social-image formats and dimensions, and LLM
  index against `siteConfig` and the current project records. Metadata, URL,
  profile, contact, asset, or project-content changes must update them together.

## Optional section integration

`src/components/Certs.astro` is a dormant section template. It remains outside the
current page render graph, so Astro does not emit its markup or scoped CSS in the
published page. To expose it later, import and render `Certs` between `Projects`
and `Contact` in `src/pages/index.astro`, then add
`{ label: 'Certs', href: '#certs' }` between the matching entries in the navbar's
link configuration. The component already owns the `#certs` fragment target and
its accessible heading relationship; no client-side controller or hydration is
required.
