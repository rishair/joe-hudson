# Frontend Aesthetics Playbook

## What this is

A method for prompting Claude (or directing your own frontend work) to produce distinctive, intentional visual design instead of generic "AI slop." Use when a goal involves the look and feel of a user-facing surface: a redesign, a new app shell, a landing page, a visual polish pass. Pairs with [[ai-web-app]] (the stack being styled) and [[qa-frontend]] (verifying the result in a real browser, including mobile). Not for backend work or for surfaces no human looks at.

Source: Anthropic cookbook, "Prompting for frontend aesthetics" (https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics).

## The core problem

Claude has strong knowledge of design principles, typography, and color theory but defaults to safe, on-distribution choices unless explicitly pushed otherwise. The default output is the recognizable AI aesthetic: Inter/Roboto, purple gradients on white, evenly-distributed timid palettes, predictable card layouts. Good design requires explicitly directing attention to each design dimension and naming the defaults to avoid.

## Three strategies

1. **Guide specific design dimensions.** Direct attention to typography, color, motion, and backgrounds individually rather than asking for "a nice design."
2. **Reference design inspirations.** Point at sources (IDE themes, cultural aesthetics, named movements) without being so prescriptive that you kill creative interpretation.
3. **Call out common defaults to avoid.** Explicitly forbid the generic choices Claude reaches for. Naming the anti-pattern is what breaks the convergence.

## The distilled aesthetics prompt (reusable block)

Append to the system prompt of any frontend-generating task:

```
<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt for distinctive choices that elevate the aesthetic.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prefer CSS-only for HTML; use the Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) beats scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Cliched color schemes (especially purple gradients on white)
- Predictable layouts and component patterns
- Cookie-cutter design lacking context-specific character

Interpret creatively. Make unexpected choices that feel genuinely designed for the context. Vary between light and dark, different fonts, different aesthetics. You still tend to converge (Space Grotesk, for example) across generations — it is critical that you think outside the box.
</frontend_aesthetics>
```

## Techniques by dimension

### Typography
- **Never use:** Inter, Roboto, Open Sans, Lato, default system fonts. Also avoid over-reaching for Space Grotesk (Claude's own convergence default).
- **Impact choices by aesthetic:**
  - Code: JetBrains Mono, Fira Code
  - Editorial: Playfair Display, Crimson Pro, Fraunces
  - Startup: Clash Display, Satoshi, Cabinet Grotesk
  - Technical: IBM Plex family, Source Sans 3
  - Distinctive: Bricolage Grotesque, Newsreader, Obviously
- **Pairing:** high contrast is interesting. Display + monospace, serif + geometric sans, or one variable font across weights.
- **Scale:** use extremes — 100/200 weight against 800/900 (not 400 vs 600); size jumps of 3x+ (not 1.5x). Pick one distinctive font and use it decisively. Load from Google Fonts. State the font choice before writing code.

### Color & theme
- Commit to one cohesive aesthetic; define it as CSS variables (design tokens).
- Dominant color + sharp accent beats an evenly-distributed palette.
- Draw from IDE themes (e.g. specific editor color schemes) and named cultural/aesthetic movements.
- **Avoid:** purple gradients on white.

### Motion
- CSS-only for plain HTML; Motion library for React when available.
- Spend the motion budget on one well-orchestrated page load with staggered reveals (`animation-delay`) rather than many scattered micro-interactions.

### Backgrounds
- Build atmosphere and depth: layered CSS gradients, geometric patterns, contextual effects. Avoid flat solid fills as the default.

## Workflow: full vs isolated prompting

- **Full block** — append the whole `<frontend_aesthetics>` block for a from-scratch design or a broad redesign.
- **Single dimension** — when one aspect is wrong (e.g. fonts) but the rest is fine, prompt only that dimension (`<use_interesting_fonts>...`) so a regeneration doesn't churn everything else.
- **Theme constraint** — to hold one aesthetic across many generations, write a locked theme block (e.g. `<always_use_solarpunk_theme>`) naming palette, shapes, textures, atmosphere, type feel. Swap the theme block to re-skin without rewriting the rest of the prompt.

Iterate by swapping the theme/dimension block, not by regenerating the full prompt each time.

## Anti-patterns

- Inter / Roboto / Arial / system fonts.
- Purple-gradient-on-white (the canonical AI-slop tell).
- Predictable card-grid layouts with no context-specific character.
- Timid evenly-spread palettes with no dominant color and no sharp accent.
- Converging on the same "safe distinctive" choice every time (Space Grotesk) — variety across generations is itself a goal.
- Asking for "a beautiful design" without naming dimensions or defaults-to-avoid — this gets you the slop.

## Recipe: applying to a project

1. Decide the aesthetic brief first, in words — what should this surface *feel* like, given what it is and who uses it? Name an inspiration or movement.
2. Choose and state the typography (one distinctive family + a contrasting pairing) and the color tokens (dominant + accent) before coding.
3. Append the full `<frontend_aesthetics>` block to the generation prompt; add a theme-constraint block if the brief is specific.
4. Implement with CSS variables for all color/spacing/type tokens so later iteration is a token swap, not a rewrite.
5. Budget motion on the page-load orchestration.
6. Verify in a real browser via [[qa-frontend]] — desktop AND mobile (the aesthetic must survive small viewports; responsive failure is a frequent regression).

## Project note: the coach app brief

For the Joe Hudson coach app ([[G-010]], redesign under its own goal), the brief is set by the subject matter: Joe's work is emotionally attuned, somatic, non-clinical, and human. The aesthetic should read **warm, calm, grounded, spacious** — the opposite of a clinical SaaS dashboard or a chatbot. Avoid corporate-blue and the AI-purple default. Favor generous whitespace, a restrained warm palette with one grounding accent, editorial/humanist typography, and quiet motion. The design should make a person feel they can slow down and be honest, not that they are filling in a form.
