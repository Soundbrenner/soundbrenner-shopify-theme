# Blog article body system

This defines the standard for `article.content` HTML on blog post pages.

## Scope

This applies only to article body HTML rendered inside:

- `/Users/simmenfl/Documents/GitHub/soundbrenner-theme-v3/sections/main-blog-post.liquid`
- container: `.sb-blog-post__content`

## Allowed HTML tags

Use only:

- `h2`
- `h3`
- `h4`
- `p`
- `ul`
- `ol`
- `li`
- `a`
- `img`
- `blockquote`
- `strong`
- `em`
- `br` (avoid for layout)

## Forbidden patterns

- No classes on content tags (`p3`, `p4`, etc.)
- No inline styles
- No `data-*` attributes
- No wrapper layout tags (`div`, `span`, `section`, `article`, `header`)
- No embeds/scripts/forms/buttons/iframes
- Do not use `<br>` to force visual spacing; split into separate `<p>` tags

## Typography mapping (automatic in CSS)

Inside `.sb-blog-post__content`:

- Body copy (`p`, `li`, `blockquote`): primary font, body size, regular weight, `line-height: 1.4`
- `h2`: primary font, callout size, bold, `line-height: 1.25`
- `h3`: primary font, body size, bold, `line-height: 1.4`
- `h4`: primary font, caption size, semibold, `line-height: 1.35`
- Links: primary-500, underline on hover/focus

## Spacing rhythm (automatic in CSS)

- Default vertical flow between direct blocks: `24px`
- `h2` section start spacing: `30px` (except first block)
- `h3`/`h4` section start spacing: `24px` (except first block)
- Heading to following body/list/quote: `12px`
- List indentation: `24px`
- `li + li` spacing: `12px`
- Blockquote: left border `2px` neutral-600 + left padding `20px`
- Images: full width, `24px` corner radius

## Authoring rules

- Use one `h2` per major section.
- Use `h3` for short labels/subsections (for example “Why it matters”).
- Keep paragraphs short (usually 1–3 sentences).
- Put each image as its own standalone block (`<img ...>`).
- Every image must have meaningful `alt`.

## SEO and metadata automation

Editorial pipeline should auto-fill on write:

- Excerpt (`summary`)
- Read time (`article.read_time`) from word count
- SEO title (`global.title_tag`)
- SEO description (`global.description_tag`)

## Prompt snippet for article-review AI

Use this exact constraint block in your editor prompt:

```text
Rewrite the article as clean semantic HTML only.
Allowed tags: h2, h3, h4, p, ul, ol, li, a, img, blockquote, strong, em.
Do not output classes (e.g. p3/p4), inline styles, data attributes, div/span wrappers, scripts, embeds, forms, or iframes.
Do not use <br> for layout; split into separate paragraphs.
Use h2 for major sections and h3 for subsection labels.
Preserve all factual meaning, links, and image URLs.
Ensure each image has descriptive alt text.
Return body HTML only.
```

