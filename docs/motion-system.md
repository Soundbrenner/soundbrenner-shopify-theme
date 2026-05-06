# Motion system

This theme uses one shared reveal pattern for premium storytelling sections.

## Rules

- Motion is opt-in.
- Use `data-sb-motion="reveal"` on the section or layout root.
- Use one `data-sb-motion-item` wrapper per motion root so the whole section enters together. The motion item can be the root itself.
- For `data-sb-carousel` sections, keep `data-sb-motion-item` on an inner wrapper, not the carousel root.
- `reviews-heading.liquid` is a special case that links the next Klaviyo reviews app section so the heading and app reveal together.
- Keep motion to opacity plus a vertical reveal only.
- The current spring reveal uses `opacity: 0`, `translateY(60px)`, and a shared spring preset aligned to `stiffness: 100`, `damping: 30`, `mass: 1`.
- Content must stay visible without JavaScript.
- Sections already in view on first paint should appear immediately instead of animating in late.
- Reduced-motion users and Theme Editor sessions should see content immediately.
- Do not add section-specific scroll handlers, parallax, or separate animation frameworks.

## Current rollout

- `sections/large-feature.liquid`
- `sections/text-section.liquid`
- `sections/value-breakdown.liquid`
- `sections/quote-section.liquid`
- `sections/top-feature-highlights.liquid`
- `sections/hero-video.liquid`
- `sections/press-ticker.liquid`
- `sections/collection-overview.liquid`
- `sections/target-audience-carousel.liquid`
- `sections/feature-carousel.liquid`
- `sections/trust-indicators.liquid`
- `sections/see-it-in-action-carousel.liquid`
- `sections/accordion.liquid`
- `sections/compare.liquid`
- `sections/footer.liquid`
- `sections/reviews-heading.liquid`
- `sections/expert-testimonials.liquid`
- `sections/spotlight-card.liquid`

## Out of scope by default

- Product buying UI
- Navigation
- Repeated product grids
- Filters and utility UI

## QA

- For deterministic screenshots or manual checks, append `?sb-motion=off` to the preview URL.
- Run `npm run qa:motion` before shipping motion changes.
