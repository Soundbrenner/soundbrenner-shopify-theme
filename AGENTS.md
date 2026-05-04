# Theme Rules

## Shopify-First Engineering

- Always implement features using native Shopify theme architecture and APIs first (Liquid, sections, blocks, snippets, schema settings, metafields, menus, locales, and Theme Editor settings).
- Prefer Shopify-supported patterns over custom scripts, custom pipelines, or framework abstractions that bypass the platform.
- Avoid hacky or brittle workarounds that go against the spirit of Shopify's system.
- Keep implementations simple, maintainable, and idiomatic to Online Store 2.0.
- When multiple approaches are possible, choose the one that is most native to Shopify and easiest for merchants to manage in the Theme Editor.
- Question the value of every feature or workaround before implementing it. Prefer the simplest acceptable solution, and push back on low-value complexity or edge-case code that adds ongoing maintenance cost.
- Use color variables only for colors in CSS. Do not hard-code color values in sections/components.
- Use scaling spacing tokens only when explicitly requested by the user. Otherwise prefer fixed, non-scaling spacing values that match existing component behavior.
- Use sentence case for UI copy labels and headings (for example `Section title`).
- Keep Theme Editor helper/documentation copy minimal and direct.
- When new assets are provided, always rename them to clean, Shopify-safe, usage-based filenames that match the element/component they are used in.
- For media upload guidance in Theme Editor, use the setting `info` on the media uploader field (not separate paragraph rows) with concise target wording in this format: `Target minimum WxH at Nx export (WxH).`
- Rendering widths must follow the media uploader `info` target dimensions. If dynamic sizing is needed, cap requests at the source asset width rather than requesting larger transformed files.
- For block-based sections, always provide at least one default block in presets/templates so the section is visible by default in Theme Editor.
- For newly created sections with a title setting, always provide a placeholder default title.
- Do not add hover easing transitions by default. Hover state changes should be instant unless explicitly requested.
- Scope all `:hover` styles with `@media (hover: hover) and (pointer: fine)` so touch devices do not get sticky hover states. Keep `:focus-visible`, `:active`, and other non-hover interaction states outside that query when needed.
- All user-facing strings must be translatable. Do not hardcode literal UI copy in Liquid, JSON templates, or JavaScript; use locale keys and the translation system by default.
- Never seed English copy into non-English locale files. Add new source strings to `locales/en.default.json` and leave non-English locale keys untranslated until real translations are provided.
- Do not author or auto-translate non-English locale values unless the user explicitly provides the final copy for those locales.
- For new copy, add keys in `locales/en.default.json` and reference those keys in code so Shopify Translate & Adapt (or equivalent apps) can manage locale translations.
- For quotation marks around dynamic text (for example search terms), do not hard-code quote characters in Liquid/JS. Put the full sentence, including opening/closing quotes, in locale strings so each language can choose correct punctuation.
- Default English quote style is curly double quotes: `“{{ term }}”`. Other locales should define their own native quote style in translation files/apps.
- When bumping the theme version in `config/settings_schema.json`, also update the 404 hero card subheadline in `templates/404.json` to match. Do not assume `theme_info.theme_version` is exposed to Liquid as `settings.theme_version`.

## Motion

- Keep motion opt-in and use the shared motion system only (`assets/section-motion.js` and `assets/motion.css`).
- Use `data-sb-motion="reveal"` on the motion root and `data-sb-motion-item` on the child wrappers that should animate.
- Limit motion to premium storytelling content. Do not animate primary buy UI, navigation, footer, repeated product grids, filters, or other utility UI unless the user explicitly asks.
- Keep the effect subtle: opacity plus small translate only. Do not add parallax, section-specific scroll handlers, or extra animation frameworks.
- Content must remain visible without JavaScript, and reduced-motion users and Theme Editor sessions must see content immediately.

## Local auth

- If GitHub CLI or Shopify credentials are needed in Codex, check `/Users/simmenfl/Desktop/LLM context personal/codex-local-auth.md` for the local auth recovery flow.
- Never store GitHub, Shopify, or deployment tokens in this repo, in `AGENTS.md`, or in committed files. Use macOS Keychain or another local secret store instead.
