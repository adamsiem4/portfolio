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
directives, or hydration runtime. Inline JavaScript is reserved for the language
and theme bootstrap because it must run before deferred modules and
before the first paint. The production Content Security Policy authorizes each generated
inline script by its SHA-256 hash; the post-build check rejects missing or stale
hashes. All other behavior is layered onto server-rendered markup through stable
`data-*` contracts.

The initial DOM already contains the correct first-project state, link targets,
ARIA relationships, image dimensions, and fallback hero text. Browser modules
enhance that state rather than constructing the page. This keeps layout independent
of JavaScript execution and avoids a client-rendering boundary.

## Languages and editable copy

Polish is canonical at `/`; English is prerendered at `/en/`. The head bootstrap
redirects only `/`, using the saved `portfolio-lang` preference or the browser's
primary language (Polish for `pl*`, English otherwise). Explicit `/en/` visits do
not overwrite that preference. Footer links persist an explicit `?lang=pl|en`
choice and remove that parameter while retaining other query parameters and fragments.
Without storage, the explicit choice still wins for that visit; without JavaScript,
the links still navigate to the selected prerendered page.

Edit shared translations and Polish project overrides in `src/i18n/ui.js`, Polish
canonical metadata and privacy copy in `src/config/site.js`, and the About paragraphs
in `src/content/about.pl.md` or `src/content/about.en.md`. Project records remain
English in `src/config/projects.js` to match `public/llms.txt`; new projects also
need Polish copy and image descriptions. Client announcements use translated DOM
templates rather than a client-side dictionary.

Keep Polish copy concise and professional, preserving product names and established
technical terms. Count labels use `Liczba projektów: {total}` and
`Liczba zdjęć: {total}` so they remain grammatical when the number of items changes.

The locale-specific email addresses live in `siteConfig.contactEmail.pl` and
`siteConfig.contactEmail.en`; visible links and structured metadata use the same address.

A single `404.html` selects its visible copy, title, navigation, and accessible
controls from the same preference. Use `bun run preview` to verify unknown paths
return HTTP 404; Vite preview uses a homepage fallback for unknown paths.

## Boot sequence

1. The inline bootstrap in `Layout.astro` resolves the language first, then a stored
   theme, falling back to `prefers-color-scheme`. It writes `data-theme` before
   rendering can flash the wrong palette.
2. Deferred component modules initialize against the complete DOM. The background
   module is inlined in the HTML (see `astro.config.mjs`), draws a settled still frame
   as soon as it runs, and starts animating on the first interaction or 5 s after
   `load`. Navigation, deck, gallery, heading, and footer controllers attach to
   existing elements. Any change to `src/scripts/cyber-background/` changes the
   inlined script's hash: run `bun run sync:csp` after editing it.

## Rendering and interaction internals

| System | Implementation details |
| --- | --- |
| Theme transition | The navbar serializes theme changes and computes a circle radius from the toggle to the farthest viewport corner. `document.startViewTransition()` performs the reveal when available; otherwise a temporary cover uses the Web Animations API. A `site-theme-change` event invalidates consumers such as the background renderer. |
| ASCII background | `CyberBackground.astro` mounts one fixed `100lvh` canvas at `z-index: -1` (body is isolated); its cell grid is plain CSS, so it is present from the first paint. `cyber-background/core.js` owns a square cell grid (14 px desktop, 12 px coarse pointers at 30 fps and DPR ≤ 1.5, backing store capped at 6 M px), the loop, pointer and touch input, a decaying wake under the cursor or finger, and theme colours. The first `ResizeObserver` callback performs the only initial measurement and draws a settled still frame; the loop starts on the first pointer move/down, touch, wheel, scroll, or key press, or 5 s after `load`, because a background that changes while the page loads never matches the final filmstrip frame and inflates Speed Index. Desktop draws at 30 fps while idle and 60 fps while the wake is active; glyphs are blitted from a per-colour atlas rebuilt on resize and theme change. Elements marked `data-background-quiet` (hero eyebrow, About copy, 404 description) dim the glyphs under them to ≤ 0.2 alpha so text keeps its contrast; a still frame is redrawn on scroll for the same reason. It pauses while hidden and stays on the settled frame under reduced motion. Touch is followed through passive `touchstart`/`touchmove` listeners because touch pointer events are cancelled once scrolling begins. A scene from `scenes/` writes per-cell intensity and heat; a `glyphs.js` preset maps intensity to characters (optionally on shaded tiles with dense glyphs knocked out) and heat to teal and faster scrambling. `siteConfig.background` selects both; the default is `swarm` with the full printable-ASCII `ascii` preset. The `swarm` scene sums metaball nodes chained into ragged streaks that drift along a flow field at half tempo, flee the cursor or finger, and scatter from mouse-click rings; clicks on interactive elements are ignored. |
| Project deck | Astro precomputes each card's translation, rotation, and stacking layer as CSS custom properties. The controller maintains one clamped active index and synchronizes `inert`, `aria-hidden`, `aria-current`, control disabled states, position text, and the live region in one update pass. |
| Deck gestures | Pointer movement is direction-locked after a 7 px threshold. Horizontal drag is capped at 110 px, receives resistance at either boundary, and changes cards after 48 px. Pointer capture keeps the gesture coherent; the following click is suppressed so a completed swipe cannot activate a card link. |
| Image gallery | Frames form a vertical scroll-snap track inside the fixed media viewport. Controls call `scrollTo()` using frame offsets, while passive scroll events schedule a single control-state calculation per animation frame. An observer threshold sequence arms the delayed scroll hint only when enough of the gallery is visible. |
| Magnetic interaction | The layout mounts `MagneticHover.astro` once to initialize `magnetic-hover.js` independently of visible components. The repeat-safe controller treats `[data-magnetic]` as the boundary and `[data-magnetic-target]` as the transformed element. Strength, travel limit, and activation media query are declarative. Pointer coordinates update targets; rendering is coalesced through `requestAnimationFrame` and reset when capability or motion preferences change. |
| Privacy dialog | A native modal `<dialog>` supplies focus containment and Escape semantics. Opening and closing are explicit states; a close requested during opening reverses the active animations. The morph transform is derived from the trigger and dialog rectangles, while reduced motion and animation failures fall back to immediate native operations. |
| Scramble headings | Canonical glyphs reserve each character's width and word wrapping; absolutely positioned random glyphs never resize the heading or move the section during scroll replays. A shared observer starts substitution on entry. Timers live in a `WeakMap`; exit and reduced-motion changes restore canonical text. |

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

`project-layout.js` applies that scale to a conservative card-slot estimate. It
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
  `project-layout.js`.
- Theme-aware canvas output depends on the `site-theme-change` event and the shared
  tokens in `src/styles/global.css`; changing theme state without dispatching the
  event leaves the existing canvas composite stale.
- Reduced-motion handling is functional, not cosmetic: galleries use immediate
  scrolling, heading substitution stops, and continuous canvas animation resolves
  to a static frame.
- `bun run check:public` validates the hand-maintained sitemap, robots file, response
  headers, web manifest, favicon/social-image formats and dimensions, and LLM
  index against `siteConfig` and the current project records. Metadata, URL,
  profile, contact, asset, or project-content changes must update them together.
- `bun run build` verifies that every generated inline script is authorized by the
  configured Content Security Policy and that no stale script hashes remain.
- Every smoke test fails on uncaught page exceptions and error-level console output.
  Dedicated page-health cases also decode every rendered image and reject horizontal
  document overflow on both home routes and the 404 page at 390×844 and 1440×900.
- `bun run validate:production` queries the deployed URL, the official Schema.org
  validator, and an independent social-card crawler, then checks the live social
  image, sitemap, robots file, and 404 directive. Run it after deployment; it stays
  outside normal builds so third-party availability cannot block local work.
- `bun run check:links` checks configured live projects, public repositories,
  social profiles, credential URLs, and the Cloudflare privacy policy. GitHub
  Actions runs it every Monday at 07:23 UTC and on manual dispatch; it is not part
  of `check`, `build`, or pull-request validation. Credential fields named
  `credentialUrl` in `src/config/*.js` are discovered automatically, while the
  dormant certifications section currently reports that none are configured.

## Continuous integration

Every pull request and push to `main` installs the committed Bun lockfile without
modification, runs `bun audit`, the source and public-file checks, and the script
unit tests, builds the production site, and executes the smoke suite in Chromium,
Firefox, and WebKit. Every workflow explicitly provisions a
Node version satisfying `engines.node` in `package.json`, rather than relying on
the runner image's default. Failed browser runs retain the HTML report, traces,
and screenshots as GitHub Actions artifacts for 14 days.

## Dependency maintenance

`packageManager` in `package.json` is the single reproducible Bun version pin;
workflows that do not explicitly request another version inherit it. Dependabot
checks Bun-managed packages and pinned GitHub Actions every Wednesday, grouping
related minor and patch updates for Astro, browser testing, interface libraries,
and development tooling while leaving major upgrades isolated for review. GitHub
Actions updates arrive as a single grouped pull request. Every Dependabot pull
request runs the full CI workflow; merge them manually once it passes.
TypeScript major upgrades are held while `astro-check` depends on the TypeScript 6
compiler API; TypeScript 7.0 cannot run that check. Remove the Dependabot ignore
after [Astro's native-compiler support](https://github.com/withastro/astro/pull/17852)
is available in the installed checker. TypeScript 6 minor and patch updates remain enabled.

Raleway and Open Sans are self-hosted variable WOFF2 files (latin and latin-ext
subsets selected by `unicode-range`) in `src/assets/fonts/`, so every visitor gets
the same metrics. Every stack names a metric-matched local Arial face
(`size-adjust` and ascent/descent overrides measured against the web fonts), so the
`font-display: swap` exchange does not rewrap or shift text; the Raleway latin file
is preloaded because it renders the LCP hero name. Desktop project copy still keeps a named, keyboard-focusable
scroll region for content that exceeds the available space.
Footer language links include their visible `PL` or `EN` code in the accessible
name, so speech-input labels match the controls under current accessibility rules.

Dependabot cannot update the Bun executable pin itself; bump `packageManager` by
hand after checking a new Bun release. Run `bun run audit:dependencies` for the same
vulnerability review locally. Bun version-update PRs are supported, but Dependabot
does not currently support automatic security-update PRs for Bun; the CI audit gate
remains necessary.

Security overrides in `package.json` pin patched transitive dependencies when the
locked upstream packages still resolve vulnerable versions. See `overrides` in
`package.json` for the current pins.
Remove an override once the upstream dependency graph resolves a fixed version
without it. LinkedIn uses a generic external-link icon because Simple Icons
removed its LinkedIn export; the link's accessible name and destination are unchanged.

## Optional section integration

`src/components/Certs.astro` is a dormant section template. It remains outside the
current page render graph, so Astro does not emit its markup or scoped CSS in the
published pages. To expose it later, import and render `Certs` between `Projects`
and `Contact` in both `src/pages/index.astro` and `src/pages/en/index.astro`, restore
its localized navbar entry, and add Polish/English certification copy. Preserve the
existing `#certs` target and restore the badge interaction regression test when the
section is enabled. Certification claims require authoritative records.
