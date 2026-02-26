#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const RAW_SHOP = (process.env.SHOPIFY_SHOP || '').trim();
const STATIC_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();
const API_VERSION = (process.env.SHOPIFY_API_VERSION || '2025-10').trim();

const args = new Set(process.argv.slice(2));
const SHOULD_CHECK_IMAGES = !args.has('--skip-image-checks');
const OUTPUT_DIR = path.resolve(process.cwd(), 'audit');

const BASE_ALLOWED_TAGS = new Set([
  'p',
  'br',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'blockquote',
  'strong',
  'em'
]);

const HARD_REJECT_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button']);
const REVIEW_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'video', 'figure', 'figcaption']);
const WRAPPER_TAGS = new Set(['div', 'span', 'font']);

function normalizeShopDomain(input) {
  const raw = (input || '').trim();
  if (!raw) return '';

  let host = raw.replace(/^https?:\/\//i, '').split('/')[0].trim();
  if (!host) return '';

  if (!host.includes('.')) host = `${host}.myshopify.com`;
  return host;
}

const SHOP = normalizeShopDomain(RAW_SHOP);

if (!SHOP || (!STATIC_ADMIN_TOKEN && (!CLIENT_ID || !CLIENT_SECRET))) {
  console.error(
    [
      'Missing required environment variables.',
      'Set:',
      '  SHOPIFY_SHOP=<your-store>.myshopify.com',
      'And one auth mode:',
      '  A) SHOPIFY_ADMIN_ACCESS_TOKEN=<admin-api-access-token>',
      '  B) SHOPIFY_CLIENT_ID=<client-id>',
      '     SHOPIFY_CLIENT_SECRET=<client-secret>',
      'Optional:',
      '  SHOPIFY_API_VERSION=2025-10'
    ].join('\n')
  );
  process.exit(1);
}

const GRAPHQL_URL = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

let oauthAccessToken = null;
let oauthAccessTokenExpiresAt = 0;

async function getAccessToken() {
  if (STATIC_ADMIN_TOKEN) return STATIC_ADMIN_TOKEN;

  if (oauthAccessToken && Date.now() < oauthAccessTokenExpiresAt - 60_000) {
    return oauthAccessToken;
  }

  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error(`Token response missing access_token: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  oauthAccessToken = payload.access_token;
  const expiresIn = Number(payload.expires_in || 0);
  oauthAccessTokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0);

  return oauthAccessToken;
}

async function shopifyGraphQL(query, variables = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GraphQL HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors).slice(0, 1000)}`);
  }

  return payload.data;
}

async function fetchAllBlogs() {
  const blogs = [];
  let after = null;
  let hasNextPage = true;

  const query = `
    query Blogs($first: Int!, $after: String) {
      blogs(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const data = await shopifyGraphQL(query, { first: 100, after });
    const connection = data.blogs;
    for (const edge of connection.edges) {
      blogs.push(edge.node);
    }
    hasNextPage = Boolean(connection.pageInfo.hasNextPage);
    after = connection.pageInfo.endCursor;
  }

  return blogs;
}

async function fetchAllArticlesForBlog(blog) {
  const articles = [];
  let after = null;
  let hasNextPage = true;

  const query = `
    query BlogArticles($id: ID!, $first: Int!, $after: String) {
      blog(id: $id) {
        id
        title
        handle
        articles(first: $first, after: $after, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              handle
              title
              author {
                name
              }
              publishedAt
              tags
              body
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const data = await shopifyGraphQL(query, { id: blog.id, first: 100, after });
    const connection = data.blog?.articles;
    if (!connection) break;
    for (const edge of connection.edges) {
      articles.push({
        ...edge.node,
        author: edge.node.author?.name || '',
        blogId: blog.id,
        blogHandle: blog.handle,
        blogTitle: blog.title
      });
    }
    hasNextPage = Boolean(connection.pageInfo.hasNextPage);
    after = connection.pageInfo.endCursor;
  }

  return articles;
}

function extractTagsAndAttributes(html) {
  const tagCounts = {};
  const attrCounts = {};
  const tagsInOrder = [];
  const imageSources = [];
  const lazySignals = [];

  const tagRegex = /<\s*\/?\s*([a-zA-Z][\w:-]*)([^>]*)>/g;
  const attrRegex = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const rawTag = match[0];
    const isClosing = /^<\s*\//.test(rawTag);
    const tag = (match[1] || '').toLowerCase();
    if (!tag || isClosing) continue;

    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    tagsInOrder.push(tag);

    const rawAttrs = match[2] || '';
    const attrMap = {};
    let attrMatch;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const name = (attrMatch[1] || '').toLowerCase();
      if (!name) continue;
      const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
      attrMap[name] = value;
      attrCounts[name] = (attrCounts[name] || 0) + 1;
    }

    if (tag === 'img') {
      const src = attrMap.src || '';
      if (src) imageSources.push(src);
      if ((attrMap.loading || '').toLowerCase() === 'lazy') {
        lazySignals.push({ type: 'loading=lazy', src });
      }
      if (attrMap['data-src']) {
        lazySignals.push({ type: 'data-src', src: attrMap['data-src'] });
      }
      if (attrMap['data-lazy']) {
        lazySignals.push({ type: 'data-lazy', src });
      }
      if (/\blazy\b/i.test(attrMap.class || '')) {
        lazySignals.push({ type: 'class*=lazy', src });
      }
    }
  }

  return { tagCounts, attrCounts, tagsInOrder, imageSources, lazySignals };
}

function normalizeImageUrl(src) {
  const trimmed = (src || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `https://${SHOP}${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function isShopifyHosted(urlString) {
  if (!urlString) return false;
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    const pathName = url.pathname.toLowerCase();
    if (pathName.startsWith('/cdn/shop/')) return true;
    if (host === SHOP.toLowerCase() && pathName.startsWith('/cdn/shop/')) return true;
    if (host.endsWith('.myshopify.com') && pathName.startsWith('/cdn/shop/')) return true;
    if (host === 'cdn.shopify.com' || host.endsWith('.cdn.shopify.com')) return true;
    if (host.endsWith('.shopifycdn.net')) return true;
    return false;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function checkImageUrl(url) {
  try {
    let response = await fetchWithTimeout(url, { method: 'HEAD' });
    if ([403, 405, 429, 500, 501, 502, 503].includes(response.status)) {
      response = await fetchWithTimeout(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    }
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = [];
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  for (let i = 0; i < safeConcurrency; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function buildArticleUrl(article) {
  return `https://${SHOP}/blogs/${article.blogHandle}/${article.handle}`;
}

function computeRiskScore({
  disallowedCount,
  reviewCount,
  wrapperCount,
  styleAttrs,
  lazySignalsCount,
  nonShopifyImageCount,
  brokenImageCount
}) {
  return (
    disallowedCount * 25 +
    reviewCount * 8 +
    wrapperCount * 1 +
    styleAttrs * 2 +
    lazySignalsCount * 2 +
    nonShopifyImageCount * 10 +
    brokenImageCount * 20
  );
}

function sortObjectByValueDescending(input) {
  return Object.fromEntries(Object.entries(input).sort((a, b) => b[1] - a[1]));
}

async function main() {
  console.log(`Fetching blogs from ${SHOP} (${API_VERSION})...`);
  const blogs = await fetchAllBlogs();
  console.log(`Found ${blogs.length} blogs.`);

  const allArticles = [];
  for (const blog of blogs) {
    const articles = await fetchAllArticlesForBlog(blog);
    allArticles.push(...articles);
    console.log(`- ${blog.title} (${blog.handle}): ${articles.length} articles`);
  }

  const globalTagCounts = {};
  const globalAttrCounts = {};
  const globalReviewTagCounts = {};
  const globalDisallowedTagCounts = {};
  const globalWrapperTagCounts = {};
  const imageToArticles = new Map();
  const articleAudits = [];

  for (const article of allArticles) {
    const html = article.body || '';
    const { tagCounts, attrCounts, imageSources, lazySignals } = extractTagsAndAttributes(html);

    for (const [tag, count] of Object.entries(tagCounts)) {
      globalTagCounts[tag] = (globalTagCounts[tag] || 0) + count;
      if (REVIEW_TAGS.has(tag)) globalReviewTagCounts[tag] = (globalReviewTagCounts[tag] || 0) + count;
      if (HARD_REJECT_TAGS.has(tag)) globalDisallowedTagCounts[tag] = (globalDisallowedTagCounts[tag] || 0) + count;
      if (WRAPPER_TAGS.has(tag)) globalWrapperTagCounts[tag] = (globalWrapperTagCounts[tag] || 0) + count;
    }
    for (const [attr, count] of Object.entries(attrCounts)) {
      globalAttrCounts[attr] = (globalAttrCounts[attr] || 0) + count;
    }

    const normalizedImageUrls = imageSources
      .map(normalizeImageUrl)
      .filter((value, index, array) => value && array.indexOf(value) === index);

    for (const src of normalizedImageUrls) {
      if (!imageToArticles.has(src)) imageToArticles.set(src, new Set());
      imageToArticles.get(src).add(article.id);
    }

    const disallowedTags = Object.keys(tagCounts).filter((tag) => HARD_REJECT_TAGS.has(tag));
    const reviewTags = Object.keys(tagCounts).filter((tag) => REVIEW_TAGS.has(tag));
    const wrapperTags = Object.keys(tagCounts).filter((tag) => WRAPPER_TAGS.has(tag));
    const nonShopifyImages = normalizedImageUrls.filter((url) => !isShopifyHosted(url));

    articleAudits.push({
      id: article.id,
      title: article.title,
      author: article.author,
      blogHandle: article.blogHandle,
      blogTitle: article.blogTitle,
      handle: article.handle,
      url: buildArticleUrl(article),
      publishedAt: article.publishedAt,
      tags: article.tags || [],
      htmlLength: html.length,
      tagCounts,
      attrCounts,
      disallowedTags,
      reviewTags,
      wrapperTags,
      lazySignals,
      imageUrls: normalizedImageUrls,
      nonShopifyImages
    });
  }

  const uniqueImages = [...imageToArticles.keys()];
  const imageCheckResults = {};

  if (SHOULD_CHECK_IMAGES && uniqueImages.length > 0) {
    console.log(`Checking ${uniqueImages.length} unique image URLs...`);
    const checks = await mapWithConcurrency(uniqueImages, 6, async (url) => ({ url, result: await checkImageUrl(url) }));
    for (const item of checks) {
      imageCheckResults[item.url] = item.result;
    }
  }

  for (const articleAudit of articleAudits) {
    const brokenImageUrls = articleAudit.imageUrls.filter((url) => {
      const check = imageCheckResults[url];
      return check && !check.ok;
    });

    const styleAttrs = articleAudit.attrCounts.style || 0;
    const disallowedCount = articleAudit.disallowedTags.reduce((sum, tag) => sum + (articleAudit.tagCounts[tag] || 0), 0);
    const reviewCount = articleAudit.reviewTags.reduce((sum, tag) => sum + (articleAudit.tagCounts[tag] || 0), 0);
    const wrapperCount = articleAudit.wrapperTags.reduce((sum, tag) => sum + (articleAudit.tagCounts[tag] || 0), 0);
    const lazySignalsCount = articleAudit.lazySignals.length;

    articleAudit.brokenImageUrls = brokenImageUrls;
    articleAudit.riskScore = computeRiskScore({
      disallowedCount,
      reviewCount,
      wrapperCount,
      styleAttrs,
      lazySignalsCount,
      nonShopifyImageCount: articleAudit.nonShopifyImages.length,
      brokenImageCount: brokenImageUrls.length
    });
  }

  const recommendedAllowedTags = Object.entries(globalTagCounts)
    .filter(([tag, count]) => count > 0 && !HARD_REJECT_TAGS.has(tag))
    .filter(([tag]) => BASE_ALLOWED_TAGS.has(tag))
    .map(([tag]) => tag)
    .sort();

  const tagsNeedingDesignDecision = Object.keys(globalReviewTagCounts).sort();
  const topRiskArticles = [...articleAudits].sort((a, b) => b.riskScore - a.riskScore).slice(0, 40);
  const nonShopifyImageArticles = articleAudits.filter((a) => a.nonShopifyImages.length > 0);
  const brokenImageArticles = articleAudits.filter((a) => a.brokenImageUrls.length > 0);
  const lazyLoadedArticles = articleAudits.filter((a) => a.lazySignals.length > 0);
  const styleHeavyArticles = articleAudits.filter((a) => (a.attrCounts.style || 0) > 0);

  const report = {
    generatedAt: new Date().toISOString(),
    shop: SHOP,
    apiVersion: API_VERSION,
    mode: 'read-only-audit',
    summary: {
      totalBlogs: blogs.length,
      totalArticles: allArticles.length,
      totalUniqueImages: uniqueImages.length,
      totalArticlesWithExternalImages: nonShopifyImageArticles.length,
      totalArticlesWithBrokenImages: brokenImageArticles.length,
      totalArticlesWithLazySignals: lazyLoadedArticles.length,
      totalArticlesWithInlineStyles: styleHeavyArticles.length
    },
    recommendation: {
      allowedTagsSuggested: recommendedAllowedTags,
      hardRejectTagsFound: Object.keys(globalDisallowedTagCounts).sort(),
      reviewTagsFound: tagsNeedingDesignDecision,
      note:
        'Review table/video/figure usage before cleanup. Keep only plain semantic content tags and remove editor/utility wrappers where possible.'
    },
    globalStats: {
      tagCounts: sortObjectByValueDescending(globalTagCounts),
      attributeCounts: sortObjectByValueDescending(globalAttrCounts),
      disallowedTagCounts: sortObjectByValueDescending(globalDisallowedTagCounts),
      reviewTagCounts: sortObjectByValueDescending(globalReviewTagCounts),
      wrapperTagCounts: sortObjectByValueDescending(globalWrapperTagCounts)
    },
    topRiskArticles,
    articles: articleAudits,
    imageChecks: imageCheckResults
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, 'blog-html-audit.json');
  const mdPath = path.join(OUTPUT_DIR, 'blog-html-audit-summary.md');

  const lines = [];
  lines.push('# Blog HTML audit summary');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Shop: ${SHOP}`);
  lines.push(`- Blogs: ${report.summary.totalBlogs}`);
  lines.push(`- Articles: ${report.summary.totalArticles}`);
  lines.push(`- Unique images: ${report.summary.totalUniqueImages}`);
  lines.push(`- Articles with non-Shopify images: ${report.summary.totalArticlesWithExternalImages}`);
  lines.push(`- Articles with broken images: ${report.summary.totalArticlesWithBrokenImages}`);
  lines.push(`- Articles with lazy-load signals: ${report.summary.totalArticlesWithLazySignals}`);
  lines.push(`- Articles with inline style attributes: ${report.summary.totalArticlesWithInlineStyles}`);
  lines.push('');
  lines.push('## Suggested allowed tags');
  lines.push('');
  lines.push(report.recommendation.allowedTagsSuggested.map((tag) => `\`${tag}\``).join(', '));
  lines.push('');
  lines.push('## Tags needing design decision');
  lines.push('');
  if (report.recommendation.reviewTagsFound.length) {
    lines.push(report.recommendation.reviewTagsFound.map((tag) => `\`${tag}\``).join(', '));
  } else {
    lines.push('None found.');
  }
  lines.push('');
  lines.push('## Hard reject tags found');
  lines.push('');
  if (report.recommendation.hardRejectTagsFound.length) {
    lines.push(report.recommendation.hardRejectTagsFound.map((tag) => `\`${tag}\``).join(', '));
  } else {
    lines.push('None found.');
  }
  lines.push('');
  lines.push('## Top 20 highest-risk articles');
  lines.push('');
  lines.push('| Score | Blog | Article | URL | Notes |');
  lines.push('| ---: | --- | --- | --- | --- |');
  for (const item of topRiskArticles.slice(0, 20)) {
    const notes = [];
    if (item.disallowedTags.length) notes.push(`disallowed: ${item.disallowedTags.join(', ')}`);
    if (item.reviewTags.length) notes.push(`review: ${item.reviewTags.join(', ')}`);
    if (item.nonShopifyImages.length) notes.push(`external images: ${item.nonShopifyImages.length}`);
    if (item.brokenImageUrls.length) notes.push(`broken images: ${item.brokenImageUrls.length}`);
    if (item.lazySignals.length) notes.push(`lazy signals: ${item.lazySignals.length}`);
    if ((item.attrCounts.style || 0) > 0) notes.push(`inline styles: ${item.attrCounts.style}`);
    lines.push(
      `| ${item.riskScore} | ${item.blogTitle} | ${item.title.replace(/\|/g, '\\|')} | ${item.url} | ${notes.join('; ') || 'none'} |`
    );
  }
  lines.push('');

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(`Report written: ${jsonPath}`);
  console.log(`Summary written: ${mdPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
