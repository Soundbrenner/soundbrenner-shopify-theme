#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const RAW_SHOP = (process.env.SHOPIFY_SHOP || '').trim();
const STATIC_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();
const API_VERSION = (process.env.SHOPIFY_API_VERSION || '2025-10').trim();

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const NETWORK_RETRIES = Math.max(0, Number.parseInt(process.env.BLOG_REWRITE_NETWORK_RETRIES || '5', 10) || 5);
const NETWORK_RETRY_BASE_MS = Math.max(50, Number.parseInt(process.env.BLOG_REWRITE_NETWORK_RETRY_BASE_MS || '350', 10) || 350);
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.BLOG_REWRITE_REQUEST_TIMEOUT_MS || '70000', 10) || 70_000);
const INTERNAL_HOSTS = new Set(['soundbrenner.myshopify.com', 'soundbrenner.com', 'www.soundbrenner.com']);
const TRACKING_QUERY_KEYS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', '_kx']);

const ALLOWED_TAGS = new Set(['p', 'br', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'strong', 'em']);
const WRAPPER_TAGS = new Set(['div', 'span', 'font', 'section', 'article', 'header']);
const REMOVE_BLOCK_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'input'];

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const applyChanges = hasFlag('apply');
const articleIdArg = (getArg('article-id') || '').trim();
const articleIdsFileArg = (getArg('article-ids-file') || '').trim();
const blogHandleArg = (getArg('blog-handle', 'articles') || 'articles').trim();
const limitArg = Number.parseInt(getArg('limit', '0'), 10) || 0;
const offsetArg = Number.parseInt(getArg('offset', '0'), 10) || 0;
const backupDirArg = (getArg('backup-dir', 'audit') || 'audit').trim();
const rewriteHandles = hasFlag('rewrite-handles');
const setReadTime = hasFlag('set-read-time');
const setSummary = !hasFlag('skip-summary');
const setSeo = !hasFlag('skip-seo');
const fallbackNoLlm = hasFlag('fallback-no-llm');

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

function normalizePathname(pathname) {
  const value = String(pathname || '').trim() || '/';
  if (value === '/') return '/';
  return value.replace(/\/+$/, '') || '/';
}

function normalizeUrlForCompare(rawValue, kind = 'link') {
  const raw = String(rawValue || '')
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/^['"]+|['"]+$/g, '');
  if (!raw) return '';
  if (raw.startsWith('#')) return raw;
  if (/^mailto:/i.test(raw) || /^tel:/i.test(raw)) return raw.toLowerCase();

  let normalizedInput = raw;
  if (normalizedInput.startsWith('//')) normalizedInput = `https:${normalizedInput}`;
  if (normalizedInput.startsWith('/')) {
    try {
      normalizedInput = new URL(normalizedInput, 'https://soundbrenner.myshopify.com').toString();
    } catch {
      // keep raw
    }
  }

  try {
    const url = new URL(normalizedInput);
    url.hostname = url.hostname.toLowerCase();
    url.pathname = normalizePathname(url.pathname);

    if (kind === 'link') {
      const keys = [...url.searchParams.keys()];
      for (const key of keys) {
        const lower = key.toLowerCase();
        if (lower.startsWith('utm_') || TRACKING_QUERY_KEYS.has(lower)) {
          url.searchParams.delete(key);
        }
      }
    }

    const sortedQuery = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    for (const [k, v] of sortedQuery) {
      url.searchParams.append(k, v);
    }

    if (kind === 'link' && INTERNAL_HOSTS.has(url.hostname)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    if (kind === 'image' && INTERNAL_HOSTS.has(url.hostname)) {
      return `${url.pathname}${url.search}`;
    }
    return `${url.protocol}//${url.hostname}${url.pathname}${url.search}${kind === 'link' ? url.hash : ''}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function collectAssetUrls(html) {
  return {
    images: unique(
      [
        ...extractAttrValues(html, 'img', 'src'),
        ...extractAttrValues(html, 'img', 'data-src'),
        ...extractAttrValues(html, 'img', 'data-sanitized-data-src')
      ].filter(Boolean)
    ),
    links: unique(extractAttrValues(html, 'a', 'href').filter(Boolean))
  };
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, label = 'request') {
  let attempt = 0;
  while (attempt <= NETWORK_RETRIES) {
    let timeout = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      if (isRetryableStatus(response.status) && attempt < NETWORK_RETRIES) {
        const delay = Math.min(10_000, NETWORK_RETRY_BASE_MS * 2 ** attempt) + Math.floor(Math.random() * 150);
        await wait(delay);
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      if (attempt >= NETWORK_RETRIES) {
        throw error;
      }
      const delay = Math.min(10_000, NETWORK_RETRY_BASE_MS * 2 ** attempt) + Math.floor(Math.random() * 150);
      await wait(delay);
      attempt += 1;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  throw new Error(`Unexpected retry loop exit for ${label}`);
}

async function loadArticleIdsFromFile(filePathArg) {
  if (!filePathArg) return [];
  const filePath = path.resolve(process.cwd(), filePathArg);
  const raw = await fs.readFile(filePath, 'utf8');
  const ids = raw
    .split(/\r?\n/)
    .map((line) => normalizeArticleId(line))
    .filter(Boolean);
  return [...new Set(ids)];
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

function sanitizeHtml(inputHtml) {
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

    if (WRAPPER_TAGS.has(normalizedTag)) continue;
    if (!ALLOWED_TAGS.has(normalizedTag)) continue;

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

  output = output
    .replace(/<p>([\s\S]*?)<br\s*\/?>\s*([\s\S]*?)<\/p>/gi, (_m, before, after) => {
      const left = String(before || '').trim();
      const right = String(after || '').trim();
      if (!left || !right) return `<p>${left}${right}</p>`;
      return `<p>${left}</p>\n<p>${right}</p>`;
    });

  return output
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateReadTimeMinutes(text) {
  const words = (text || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function slugifyHandle(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 255);
}

function truncateAtWordBoundary(text, maxChars) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  const clipped = value.slice(0, maxChars + 1);
  const idx = clipped.lastIndexOf(' ');
  const base = idx > 0 ? clipped.slice(0, idx) : clipped.slice(0, maxChars);
  return `${base.replace(/[.,;:!?-]+$/g, '')}…`;
}

function fallbackSummaryFromBody(bodyHtml) {
  const text = stripHtmlToText(bodyHtml);
  return truncateAtWordBoundary(text, 220);
}

function fallbackSeoTitle(articleTitle) {
  return truncateAtWordBoundary(String(articleTitle || '').trim(), 60);
}

function fallbackSeoDescription(summaryText, bodyHtml) {
  const base = summaryText && summaryText.trim() ? summaryText : stripHtmlToText(bodyHtml);
  return truncateAtWordBoundary(base, 155);
}

function deriveAltFromImageSrc(src, articleTitle) {
  try {
    const pathname = new URL(src).pathname || '';
    const file = pathname.split('/').pop() || '';
    const noExt = file.replace(/\.[a-z0-9]+$/i, '');
    const normalized = noExt
      .replace(/[_-]+/g, ' ')
      .replace(/\bimage\s*\d+\b/gi, '')
      .replace(/\bv\d+\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized) return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  } catch {
    // ignore
  }
  return `${articleTitle} image`;
}

function ensureImageAltText(html, articleTitle) {
  return String(html || '').replace(/<img\b([^>]*)>/gi, (full, rawAttrs) => {
    const attrs = parseAttributes(rawAttrs || '');
    const src = (attrs.src || '').trim();
    if (!src) return full;
    const alt = (attrs.alt || '').trim();
    const finalAlt = alt || deriveAltFromImageSrc(src, articleTitle);
    const width = (attrs.width || '').trim();
    const height = (attrs.height || '').trim();
    const widthAttr = /^\d+$/.test(width) ? ` width="${width}"` : '';
    const heightAttr = /^\d+$/.test(height) ? ` height="${height}"` : '';
    return `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(finalAlt)}"${widthAttr}${heightAttr}>`;
  });
}

function extractAttrValues(html, tagName, attrName) {
  const values = [];
  const regex = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  let match;
  while ((match = regex.exec(html || '')) !== null) {
    const attrs = parseAttributes(match[1] || '');
    const value = (attrs[attrName] || '').trim();
    if (value) values.push(value);
  }
  return values;
}

function unique(array) {
  return [...new Set(array)];
}

function ensureRequiredAssets(beforeHtml, afterHtml) {
  const beforeAssets = collectAssetUrls(beforeHtml);
  const afterAssets = {
    images: unique(extractAttrValues(afterHtml, 'img', 'src').filter(Boolean)),
    links: unique(extractAttrValues(afterHtml, 'a', 'href').filter(Boolean))
  };

  const afterImageSet = new Set(afterAssets.images.map((url) => normalizeUrlForCompare(url, 'image')).filter(Boolean));
  const afterLinkSet = new Set(afterAssets.links.map((url) => normalizeUrlForCompare(url, 'link')).filter(Boolean));

  const missingImages = beforeAssets.images.filter(
    (url) => !afterImageSet.has(normalizeUrlForCompare(url, 'image'))
  );
  const missingLinks = beforeAssets.links.filter(
    (url) => !afterLinkSet.has(normalizeUrlForCompare(url, 'link'))
  );
  return {
    ok: missingImages.length === 0 && missingLinks.length === 0,
    missingImages,
    missingLinks
  };
}

function buildMissingImageRecoveryHtml(missingImages, articleTitle) {
  const urls = unique((missingImages || []).filter(Boolean));
  if (urls.length === 0) return '';
  return urls
    .map((src) => `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(deriveAltFromImageSrc(src, articleTitle))}">`)
    .join('\n');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // best effort: pull outermost JSON object
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const sliced = text.slice(start, end + 1);
      return JSON.parse(sliced);
    }
    throw new Error('Failed to parse JSON from LLM response.');
  }
}

let oauthAccessToken = null;
let oauthAccessTokenExpiresAt = 0;

async function getShopifyAccessToken(shop) {
  if (STATIC_ADMIN_TOKEN) return STATIC_ADMIN_TOKEN;
  if (oauthAccessToken && Date.now() < oauthAccessTokenExpiresAt - 60_000) return oauthAccessToken;

  const response = await fetchWithRetry(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  }, 'shopify-oauth-token');

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
  const token = await getShopifyAccessToken(shop);
  const response = await fetchWithRetry(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  }, 'shopify-graphql');

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shopify GraphQL HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }
  const payload = JSON.parse(text);
  if (payload.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(payload.errors).slice(0, 1000)}`);
  }
  return payload.data;
}

async function getBlogs(shop) {
  const query = `
    query Blogs($first: Int!, $after: String) {
      blogs(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { id handle title } }
      }
    }
  `;
  const blogs = [];
  let hasNextPage = true;
  let after = null;
  while (hasNextPage) {
    const data = await shopifyGraphQL(shop, query, { first: 100, after });
    for (const edge of data.blogs.edges) blogs.push(edge.node);
    hasNextPage = Boolean(data.blogs.pageInfo.hasNextPage);
    after = data.blogs.pageInfo.endCursor;
  }
  return blogs;
}

async function getArticlesForBlog(shop, blogId) {
  const query = `
    query BlogArticles($id: ID!, $first: Int!, $after: String) {
      blog(id: $id) {
        id
        handle
        title
        articles(first: $first, after: $after, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              handle
              body
              summary
              tags
              publishedAt
              readTime: metafield(namespace: "article", key: "read_time") {
                id
                type
                value
              }
              seoTitle: metafield(namespace: "global", key: "title_tag") {
                id
                type
                value
              }
              seoDescription: metafield(namespace: "global", key: "description_tag") {
                id
                type
                value
              }
            }
          }
        }
      }
    }
  `;

  const results = [];
  let hasNextPage = true;
  let after = null;
  while (hasNextPage) {
    const data = await shopifyGraphQL(shop, query, { id: blogId, first: 100, after });
    const connection = data.blog?.articles;
    if (!connection) break;
    for (const edge of connection.edges) {
      results.push({
        ...edge.node,
        blogId,
        blogHandle: data.blog.handle,
        blogTitle: data.blog.title
      });
    }
    hasNextPage = Boolean(connection.pageInfo.hasNextPage);
    after = connection.pageInfo.endCursor;
  }
  return results;
}

async function getArticleById(shop, articleId) {
  const query = `
    query ArticleById($id: ID!) {
      article(id: $id) {
        id
        title
        handle
        body
        summary
        tags
        publishedAt
        readTime: metafield(namespace: "article", key: "read_time") {
          id
          type
          value
        }
        seoTitle: metafield(namespace: "global", key: "title_tag") {
          id
          type
          value
        }
        seoDescription: metafield(namespace: "global", key: "description_tag") {
          id
          type
          value
        }
        blog { id handle title }
      }
    }
  `;
  const data = await shopifyGraphQL(shop, query, { id: articleId });
  if (!data.article) return null;
  return {
    ...data.article,
    blogId: data.article.blog.id,
    blogHandle: data.article.blog.handle,
    blogTitle: data.article.blog.title
  };
}

async function updateArticle(shop, articleId, articleInput) {
  const mutation = `
    mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id title }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL(shop, mutation, { id: articleId, article: articleInput });
  return data.articleUpdate;
}

async function llmRewriteArticle(article, options = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY for LLM rewrite.');
  }
  const strictAssets = options.strictAssets || null;

  const systemPrompt = [
    'You are a professional web editor for a music brand blog.',
    'Rewrite article HTML for clarity, grammar, and readability while preserving factual meaning.',
    'Do not invent facts.',
    'Preserve all links and image URLs from source.',
    'Use clean semantic HTML only.',
    'Allowed tags: p, br, h2, h3, h4, ul, ol, li, a, img, blockquote, strong, em.',
    'No classes (e.g., p3/p4), styles, data-* attributes, scripts, iframes, forms, buttons.',
    'Use h2 for major sections and h3 for subsection labels.',
    'Keep paragraphs concise (usually 1–3 sentences each).',
    'Place each image as a standalone <img> between paragraphs, not inside layout wrappers.',
    'Do not use <br> inside paragraphs for layout. Split into separate <p> blocks instead.',
    'Keep sentence case headings.',
    'Also generate a meaningful excerpt and SEO fields.',
    'Output strict JSON only: {"body_html":"...","excerpt_text":"...","seo_title":"...","seo_description":"...","suggested_handle":"...","editor_notes":"..."}'
  ].join(' ');

  const strictBlock = strictAssets
    ? [
        'STRICT ASSET PRESERVATION MODE:',
        'Do not remove any required link/image URLs listed below.',
        'Each required URL must appear at least once in the output HTML.',
        strictAssets.missingLinks?.length
          ? `Previously missing links: ${strictAssets.missingLinks.join(' | ')}`
          : '',
        strictAssets.missingImages?.length
          ? `Previously missing images: ${strictAssets.missingImages.join(' | ')}`
          : '',
        strictAssets.requiredLinks?.length
          ? `Required links: ${strictAssets.requiredLinks.join(' | ')}`
          : '',
        strictAssets.requiredImages?.length
          ? `Required images: ${strictAssets.requiredImages.join(' | ')}`
          : ''
      ]
          .filter(Boolean)
          .join('\n')
    : '';

  const userPrompt = [
    `Title: ${article.title}`,
    `Tags: ${(article.tags || []).join(', ')}`,
    strictBlock,
    'Source HTML:',
    article.body || ''
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await fetchWithRetry(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  }, 'openai-chat-completions');

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LLM API HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }

  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content || '';
  const parsed = safeJsonParse(content);
  const rewritten = String(parsed.body_html || '').trim();
  if (!rewritten) {
    throw new Error('LLM returned empty body_html.');
  }
  return {
    bodyHtml: rewritten,
    excerptText: String(parsed.excerpt_text || '').trim(),
    seoTitle: String(parsed.seo_title || '').trim(),
    seoDescription: String(parsed.seo_description || '').trim(),
    suggestedHandle: String(parsed.suggested_handle || '').trim(),
    editorNotes: String(parsed.editor_notes || '').trim()
  };
}

function summarizeChanges(before, after) {
  return {
    beforeLength: before.length,
    afterLength: after.length,
    delta: after.length - before.length,
    beforeImageCount: extractAttrValues(before, 'img', 'src').length + extractAttrValues(before, 'img', 'data-src').length,
    afterImageCount: extractAttrValues(after, 'img', 'src').length,
    beforeLinkCount: extractAttrValues(before, 'a', 'href').length,
    afterLinkCount: extractAttrValues(after, 'a', 'href').length
  };
}

function toShopUrl(shop, article) {
  return `https://${shop}/blogs/${article.blogHandle}/${article.handle}`;
}

async function main() {
  const shop = normalizeShopDomain(RAW_SHOP);
  const targetArticleId = normalizeArticleId(articleIdArg);
  const targetArticleIds = await loadArticleIdsFromFile(articleIdsFileArg);
  const backupDir = path.resolve(process.cwd(), backupDirArg);

  if (!shop || (!STATIC_ADMIN_TOKEN && (!CLIENT_ID || !CLIENT_SECRET))) {
    console.error(
      [
        'Missing Shopify auth inputs.',
        'Set:',
        '  SHOPIFY_SHOP=<your-store>.myshopify.com',
        'And one auth mode:',
        '  A) SHOPIFY_ADMIN_ACCESS_TOKEN=<admin-api-access-token>',
        '  B) SHOPIFY_CLIENT_ID=<client-id>',
        '     SHOPIFY_CLIENT_SECRET=<client-secret>'
      ].join('\n')
    );
    process.exit(1);
  }

  if (!OPENAI_API_KEY && !fallbackNoLlm) {
    console.error('Missing OPENAI_API_KEY. This script requires an LLM API key.');
    process.exit(1);
  }

  let targets = [];
  if (targetArticleIds.length > 0) {
    for (const id of targetArticleIds) {
      const article = await getArticleById(shop, id);
      if (!article) {
        console.warn(`Article not found (skipped): ${id}`);
        continue;
      }
      targets.push(article);
    }
  } else if (targetArticleId) {
    const article = await getArticleById(shop, targetArticleId);
    if (!article) {
      console.error(`Article not found: ${targetArticleId}`);
      process.exit(1);
    }
    targets = [article];
  } else {
    const blogs = await getBlogs(shop);
    const blog = blogs.find((b) => b.handle === blogHandleArg) || blogs[0];
    if (!blog) {
      console.error('No blogs found.');
      process.exit(1);
    }
    const all = await getArticlesForBlog(shop, blog.id);
    const sliced = all.slice(Math.max(0, offsetArg), limitArg > 0 ? Math.max(0, offsetArg) + limitArg : undefined);
    targets = sliced;
  }

  if (targets.length === 0) {
    console.log('No target articles selected.');
    return;
  }

  console.log(`Mode: ${applyChanges ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Articles selected: ${targets.length}`);
  console.log(`Model: ${OPENAI_MODEL}`);
  console.log(`Options: readTime=${setReadTime}, summary=${setSummary}, seo=${setSeo}, rewriteHandles=${rewriteHandles}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.mkdir(backupDir, { recursive: true });
  const reportPath = path.join(backupDir, `blog-llm-rewrite-report-${timestamp}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    shop,
    apiVersion: API_VERSION,
    mode: applyChanges ? 'apply' : 'dry-run',
    model: OPENAI_MODEL,
    selectedCount: targets.length,
    items: []
  };

  for (let i = 0; i < targets.length; i += 1) {
    const article = targets[i];
    const item = {
      index: i + 1,
      id: article.id,
      title: article.title,
      url: toShopUrl(shop, article),
      status: 'pending'
    };
    report.items.push(item);

    try {
      console.log(`[${i + 1}/${targets.length}] Rewriting: ${article.title}`);
      const before = article.body || '';
      const baseAssets = collectAssetUrls(before);
      let llm = {
        bodyHtml: before,
        excerptText: '',
        seoTitle: '',
        seoDescription: '',
        suggestedHandle: '',
        editorNotes: fallbackNoLlm ? 'fallback_no_llm' : ''
      };
      if (!fallbackNoLlm) {
        llm = await llmRewriteArticle(article);
      }
      let sanitized = ensureImageAltText(sanitizeHtml(llm.bodyHtml), article.title);

      let assetCheck = ensureRequiredAssets(before, sanitized);
      if (!fallbackNoLlm && !assetCheck.ok) {
        llm = await llmRewriteArticle(article, {
          strictAssets: {
            requiredLinks: baseAssets.links,
            requiredImages: baseAssets.images,
            missingLinks: assetCheck.missingLinks,
            missingImages: assetCheck.missingImages
          }
        });
        sanitized = ensureImageAltText(sanitizeHtml(llm.bodyHtml), article.title);
        assetCheck = ensureRequiredAssets(before, sanitized);
      }

      if (assetCheck.missingImages.length > 0) {
        const recoveryImageHtml = buildMissingImageRecoveryHtml(assetCheck.missingImages, article.title);
        if (recoveryImageHtml) {
          sanitized = `${sanitized}\n${recoveryImageHtml}`.trim();
          sanitized = ensureImageAltText(sanitizeHtml(sanitized), article.title);
          assetCheck = ensureRequiredAssets(before, sanitized);
        }
      }

      if (assetCheck.missingImages.length > 0) {
        throw new Error(
          `Asset image preservation failed (missing images: ${assetCheck.missingImages.length})`
        );
      }
      if (assetCheck.missingLinks.length > 0) {
        item.assetWarnings = {
          missingLinks: assetCheck.missingLinks.length
        };
        console.warn(`  warning: link preservation mismatch (missing links: ${assetCheck.missingLinks.length})`);
      }

      const computedReadTimeMinutes = estimateReadTimeMinutes(stripHtmlToText(sanitized));
      const excerptText = setSummary
        ? (llm.excerptText && llm.excerptText.trim() ? truncateAtWordBoundary(llm.excerptText, 220) : fallbackSummaryFromBody(sanitized))
        : String(article.summary || '');
      const seoTitle = setSeo
        ? (llm.seoTitle && llm.seoTitle.trim() ? truncateAtWordBoundary(llm.seoTitle, 60) : fallbackSeoTitle(article.title))
        : String(article.seoTitle?.value || '');
      const seoDescription = setSeo
        ? (llm.seoDescription && llm.seoDescription.trim()
            ? truncateAtWordBoundary(llm.seoDescription, 155)
            : fallbackSeoDescription(excerptText, sanitized))
        : String(article.seoDescription?.value || '');
      const nextHandle = rewriteHandles
        ? (slugifyHandle(llm.suggestedHandle) || slugifyHandle(article.title) || article.handle)
        : article.handle;

      const summary = summarizeChanges(before, sanitized);
      item.editorNotes = llm.editorNotes;
      item.beforeLength = summary.beforeLength;
      item.afterLength = summary.afterLength;
      item.delta = summary.delta;
      item.beforeLinkCount = summary.beforeLinkCount;
      item.afterLinkCount = summary.afterLinkCount;
      item.beforeImageCount = summary.beforeImageCount;
      item.afterImageCount = summary.afterImageCount;
      item.readTimeBefore = article.readTime?.value || '';
      item.readTimeAfter = String(computedReadTimeMinutes);
      item.excerptBefore = article.summary || '';
      item.excerptAfter = excerptText;
      item.seoTitleBefore = article.seoTitle?.value || '';
      item.seoTitleAfter = seoTitle;
      item.seoDescriptionBefore = article.seoDescription?.value || '';
      item.seoDescriptionAfter = seoDescription;
      item.handleBefore = article.handle;
      item.handleAfter = nextHandle;
      item.beforeBody = before;
      item.afterBody = sanitized;

      if (applyChanges) {
        const metafields = [];
        if (setReadTime) {
          metafields.push({
            namespace: 'article',
            key: 'read_time',
            type: article.readTime?.type || 'single_line_text_field',
            value: String(computedReadTimeMinutes)
          });
        }
        if (setSeo) {
          metafields.push({
            namespace: 'global',
            key: 'title_tag',
            type: article.seoTitle?.type || 'single_line_text_field',
            value: seoTitle
          });
          metafields.push({
            namespace: 'global',
            key: 'description_tag',
            type: article.seoDescription?.type || 'single_line_text_field',
            value: seoDescription
          });
        }

        const articleInput = {
          body: sanitized
        };

        if (setSummary) articleInput.summary = excerptText;
        if (rewriteHandles && nextHandle && nextHandle !== article.handle) {
          articleInput.handle = nextHandle;
          articleInput.redirectNewHandle = true;
        }
        if (metafields.length > 0) {
          articleInput.metafields = metafields;
        }

        const update = await updateArticle(shop, article.id, articleInput);
        if (update.userErrors?.length) {
          throw new Error(`Shopify userErrors: ${JSON.stringify(update.userErrors)}`);
        }
        item.status = 'updated';
      } else {
        item.status = 'previewed';
      }
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : String(error);
      console.error(`  failed: ${item.error}`);
    }
  }

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Report saved: ${reportPath}`);

  const updated = report.items.filter((x) => x.status === 'updated').length;
  const previewed = report.items.filter((x) => x.status === 'previewed').length;
  const failed = report.items.filter((x) => x.status === 'failed').length;
  console.log(`Done. updated=${updated}, previewed=${previewed}, failed=${failed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
