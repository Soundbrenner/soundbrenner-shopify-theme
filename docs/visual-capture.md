# Visual capture config

`scripts/visual-capture.config.json` supports page-level actions so screenshots can include specific UI states.

## Page shape

```json
{
  "name": "product-hover-state",
  "path": "/products/wave-pro-in-ear-monitors",
  "viewport": { "width": 1512, "height": 982 },
  "fullPage": false,
  "waitAfterGotoMs": 600,
  "actions": [
    { "type": "hover", "selector": ".sb-product-thumbnail__media-wrap" },
    { "type": "wait", "ms": 200 }
  ]
}
```

## Supported action types

- `wait` with `ms`
- `waitForSelector` with `selector`, optional `state`, optional `timeout`
- `click` with `selector`, optional `timeout`
- `hover` with `selector`, optional `timeout`
- `focus` with `selector`, optional `timeout`
- `type` with `selector`, `text`, optional `delay`, optional `timeout`
- `press` with `key`
- `scroll` with either `selector` or `x`/`y`
- `evaluate` with `script` (string passed to `page.evaluate`)
- `screenshot` with `path`, optional `fullPage`
