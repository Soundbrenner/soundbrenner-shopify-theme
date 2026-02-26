#!/usr/bin/env node

const RAW_SHOP = (process.env.SHOPIFY_SHOP || '').trim();
const STATIC_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();
const API_VERSION = (process.env.SHOPIFY_API_VERSION || '2025-10').trim();

const args = process.argv.slice(2);
const getArg = (name) => {
  const prefix = `--${name}=`;
  const hit = args.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};
const hasFlag = (name) => args.includes(`--${name}`);

const articleIdArg = (getArg('article-id') || '').trim();
const applyChanges = hasFlag('apply');

const ALLOWED_TAGS = new Set(['p', 'br', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'strong', 'em']);
const WRAPPER_TAGS = new Set(['div', 'span', 'font', 'section', 'article', 'header']);
const REMOVE_BLOCK_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'input'];

function normalizeShopDomain(input) {
  const raw = (input || '').trim();
  if (!raw) return '';

  let host = raw.replace(/^https?:\/\//i, '').split('/')[0].trim();
  if (!host) return '';
  if (!host.includes('.')) host = `${host}.myshopify.com`;
  return host;
}

function normalizeArticleId(input) {
  const raw = (input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('gid://shopify/Article/')) return raw;
  const numeric = raw.match(/\d+/)?.[0];
  return numeric ? `gid://shopify/Article/${numeric}` : '';
}

function escapeHtmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseAttributes(rawAttrs) {
  const attrs = {};
  const attrRegex = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRegex.exec(rawAttrs || '')) !== null) {
    const name = (match[1] || '').toLowerCase();
    if (!name) continue;
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function stripDisallowedBlocks(html) {
  let cleaned = html || '';
  for (const tag of REMOVE_BLOCK_TAGS) {
    const blockPattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    const selfPattern = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    cleaned = cleaned.replace(blockPattern, '');
    cleaned = cleaned.replace(selfPattern, '');
  }
  return cleaned;
}

function normalizeTagName(tag) {
  const t = (tag || '').toLowerCase();
  if (t === 'b') return 'strong';
  if (t === 'i') return 'em';
  return t;
}

function normalizeHtml(inputHtml) {
  const html = stripDisallowedBlocks(inputHtml);
  const tagRegex = /<\s*\/?\s*([a-zA-Z][\w:-]*)([^>]*)>/g;
  let output = '';
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    output += html.slice(lastIndex, match.index);
    lastIndex = tagRegex.lastIndex;

    const rawTag = match[0];
    const isClosing = /^<\s*\//.test(rawTag);
    const normalizedTag = normalizeTagName(match[1]);
    const rawAttrs = match[2] || '';
    const isSelfClosing = /\/\s*>$/.test(rawTag);

    if (WRAPPER_TAGS.has(normalizedTag)) {
      continue;
    }

    if (!ALLOWED_TAGS.has(normalizedTag)) {
      continue;
    }

    if (isClosing) {
      if (normalizedTag === 'img' || normalizedTag === 'br') continue;
      output += `</${normalizedTag}>`;
      continue;
    }

    if (normalizedTag === 'a') {
      const attrs = parseAttributes(rawAttrs);
      const href = (attrs.href || '').trim();
      if (!href) continue;
      output += `<a href="${escapeHtmlAttr(href)}">`;
      continue;
    }

    if (normalizedTag === 'img') {
      const attrs = parseAttributes(rawAttrs);
      const src = (attrs.src || attrs['data-src'] || attrs['data-sanitized-data-src'] || '').trim();
      if (!src) continue;

      const alt = attrs.alt || '';
      const width = (attrs.width || '').trim();
      const height = (attrs.height || '').trim();
      const widthAttr = /^\d+$/.test(width) ? ` width="${width}"` : '';
      const heightAttr = /^\d+$/.test(height) ? ` height="${height}"` : '';
      output += `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}"${widthAttr}${heightAttr}>`;
      continue;
    }

    if (normalizedTag === 'br') {
      output += '<br>';
      continue;
    }

    output += `<${normalizedTag}${isSelfClosing ? ' /' : ''}>`;
  }

  output += html.slice(lastIndex);

  return output
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countTags(html) {
  const counts = {};
  const tagRegex = /<\s*\/?\s*([a-zA-Z][\w:-]*)[^>]*>/g;
  let match;
  while ((match = tagRegex.exec(html || '')) !== null) {
    const rawTag = match[0];
    if (/^<\s*\//.test(rawTag)) continue;
    const tag = normalizeTagName(match[1]);
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

let oauthAccessToken = null;
let oauthAccessTokenExpiresAt = 0;

async function getAccessToken(shop) {
  if (STATIC_ADMIN_TOKEN) return STATIC_ADMIN_TOKEN;
  if (oauthAccessToken && Date.now() < oauthAccessTokenExpiresAt - 60_000) return oauthAccessToken;

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Token request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const payload = JSON.parse(text);
  if (!payload.access_token) {
    throw new Error(`Token response missing access_token: ${text.slice(0, 500)}`);
  }

  oauthAccessToken = payload.access_token;
  const expiresIn = Number(payload.expires_in || 0);
  oauthAccessTokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0);
  return oauthAccessToken;
}

async function shopifyGraphQL(shop, query, variables = {}) {
  const token = await getAccessToken(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GraphQL HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }

  const payload = JSON.parse(text);
  if (payload.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors).slice(0, 1000)}`);
  }
  return payload.data;
}

async function fetchArticle(shop, articleGid) {
  const query = `
    query ArticleById($id: ID!) {
      article(id: $id) {
        id
        title
        handle
        body
        tags
        blog {
          id
          handle
          title
        }
      }
    }
  `;
  const data = await shopifyGraphQL(shop, query, { id: articleGid });
  return data.article;
}

async function updateArticleBody(shop, articleId, body) {
  const mutation = `
    mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article {
          id
          title
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyGraphQL(shop, mutation, {
    id: articleId,
    article: { body }
  });
  return data.articleUpdate;
}

async function main() {
  const shop = normalizeShopDomain(RAW_SHOP);
  const articleId = normalizeArticleId(articleIdArg);

  if (!shop || (!STATIC_ADMIN_TOKEN && (!CLIENT_ID || !CLIENT_SECRET)) || !articleId) {
    console.error(
      [
        'Missing required inputs.',
        'Set:',
        '  SHOPIFY_SHOP=<your-store>.myshopify.com',
        'And one auth mode:',
        '  A) SHOPIFY_ADMIN_ACCESS_TOKEN=<admin-api-access-token>',
        '  B) SHOPIFY_CLIENT_ID=<client-id>',
        '     SHOPIFY_CLIENT_SECRET=<client-secret>',
        'Run:',
        '  node scripts/clean-blog-article.mjs --article-id=<id-or-gid> [--apply]'
      ].join('\n')
    );
    process.exit(1);
  }

  console.log(`Fetching article ${articleId}...`);
  const article = await fetchArticle(shop, articleId);
  if (!article) {
    console.error('Article not found.');
    process.exit(1);
  }

  const before = article.body || '';
  const after = normalizeHtml(before);
  const beforeTags = countTags(before);
  const afterTags = countTags(after);

  console.log(`Title: ${article.title}`);
  console.log(`URL: https://${shop}/blogs/${article.blog.handle}/${article.handle}`);
  console.log(`Length: ${before.length} -> ${after.length}`);
  console.log(`Tags before: ${JSON.stringify(beforeTags)}`);
  console.log(`Tags after : ${JSON.stringify(afterTags)}`);

  if (!applyChanges) {
    console.log('');
    console.log('Dry run only. No changes written.');
    return;
  }

  const result = await updateArticleBody(shop, article.id, after);
  if (result.userErrors?.length) {
    console.error(`Update failed: ${JSON.stringify(result.userErrors)}`);
    process.exit(1);
  }
  console.log(`Updated article: ${result.article?.id} (${result.article?.title})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

