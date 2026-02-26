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

const NETWORK_RETRIES = Math.max(0, Number.parseInt(process.env.BLOG_TAG_AUDIT_NETWORK_RETRIES || '4', 10) || 4);
const NETWORK_RETRY_BASE_MS = Math.max(50, Number.parseInt(process.env.BLOG_TAG_AUDIT_NETWORK_RETRY_BASE_MS || '300', 10) || 300);
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.BLOG_TAG_AUDIT_REQUEST_TIMEOUT_MS || '60000', 10) || 60_000);

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const applyChanges = hasFlag('apply');
const blogHandleArg = (getArg('blog-handle', 'articles') || 'articles').trim();
const articleIdArg = (getArg('article-id') || '').trim();
const limitArg = Number.parseInt(getArg('limit', '0'), 10) || 0;
const offsetArg = Number.parseInt(getArg('offset', '0'), 10) || 0;
const backupDirArg = (getArg('backup-dir', 'audit') || 'audit').trim();
const minConfidence = Math.min(1, Math.max(0, Number.parseFloat(getArg('min-confidence', '0.75')) || 0.75));

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
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
        const delay = Math.min(10_000, NETWORK_RETRY_BASE_MS * 2 ** attempt) + Math.floor(Math.random() * 120);
        await wait(delay);
        attempt += 1;
        continue;
      }

      return response;
    } catch (error) {
      if (attempt >= NETWORK_RETRIES) throw error;
      const delay = Math.min(10_000, NETWORK_RETRY_BASE_MS * 2 ** attempt) + Math.floor(Math.random() * 120);
      await wait(delay);
      attempt += 1;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  throw new Error(`Unexpected retry exit for ${label}`);
}

let oauthAccessToken = null;
let oauthAccessTokenExpiresAt = 0;

async function getShopifyAccessToken(shop) {
  if (STATIC_ADMIN_TOKEN) return STATIC_ADMIN_TOKEN;
  if (oauthAccessToken && Date.now() < oauthAccessTokenExpiresAt - 60_000) return oauthAccessToken;

  const response = await fetchWithRetry(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      })
    },
    'shopify-oauth-token'
  );

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
  const response = await fetchWithRetry(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
      },
      body: JSON.stringify({ query, variables })
    },
    'shopify-graphql'
  );

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
              summary
              body
              tags
              publishedAt
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
        summary
        body
        tags
        publishedAt
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

async function updateArticleTags(shop, articleId, tags) {
  const mutation = `
    mutation UpdateArticleTags($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id title tags }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphQL(shop, mutation, {
    id: articleId,
    article: { tags }
  });
  return data.articleUpdate;
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

function unique(values) {
  return [...new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean))];
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const sliced = text.slice(start, end + 1);
      return JSON.parse(sliced);
    }
    throw new Error('Failed to parse JSON from LLM response.');
  }
}

function normalizeDecisionList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const tag = String(item.tag || '').trim();
      if (!tag) return null;
      const confidenceRaw = Number(item.confidence);
      const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;
      const reason = String(item.reason || '').trim();
      return { tag, confidence, reason };
    })
    .filter(Boolean);
}

function resolveTagChanges(currentTags, addDecisions, removeDecisions, confidenceCutoff) {
  const current = new Set(unique(currentTags));

  const acceptedAdds = addDecisions.filter((d) => d.confidence >= confidenceCutoff && !current.has(d.tag));
  const acceptedRemoves = removeDecisions.filter((d) => d.confidence >= confidenceCutoff && current.has(d.tag));

  const next = new Set(current);
  for (const add of acceptedAdds) next.add(add.tag);
  for (const rem of acceptedRemoves) next.delete(rem.tag);

  return {
    nextTags: [...next],
    acceptedAdds,
    acceptedRemoves
  };
}

function tagsEqual(a, b) {
  const left = unique(a).sort((x, y) => x.localeCompare(y));
  const right = unique(b).sort((x, y) => x.localeCompare(y));
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function summarizeTagFrequency(articles) {
  const counts = new Map();
  for (const article of articles) {
    for (const tag of unique(article.tags || [])) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

async function llmAuditTagsForArticle(article, vocabulary, tagFrequencyMap) {
  const bodyText = stripHtmlToText(article.body || '');
  const contentSnippet = bodyText.slice(0, 12_000);
  const currentTags = unique(article.tags || []);

  const vocabLines = vocabulary.map((tag) => `- ${tag} (${tagFrequencyMap.get(tag) || 0})`).join('\n');

  const systemPrompt = [
    'You are a taxonomy editor for Soundbrenner blog content.',
    'You must decide whether each article needs tag additions/removals based on title and content.',
    'Use only tags from the provided candidate list.',
    'Do not invent new tags.',
    'Avoid over-tagging; keep tags precise and useful for navigation.',
    'Keep existing tags unless there is clear mismatch.',
    'Return strict JSON only in this shape:',
    '{"add":[{"tag":"...","confidence":0.0,"reason":"..."}],"remove":[{"tag":"...","confidence":0.0,"reason":"..."}],"notes":"..."}'
  ].join(' ');

  const userPrompt = [
    `Article title: ${article.title}`,
    `Current tags: ${currentTags.join(', ') || '(none)'}`,
    article.summary ? `Summary: ${article.summary}` : '',
    'Content excerpt:',
    contentSnippet,
    'Candidate tags (with article frequency counts):',
    vocabLines
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await fetchWithRetry(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    },
    'openai-chat-completions'
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LLM API HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }

  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content || '';
  const parsed = safeJsonParse(content);

  const add = normalizeDecisionList(parsed.add).filter((d) => vocabulary.includes(d.tag));
  const remove = normalizeDecisionList(parsed.remove).filter((d) => vocabulary.includes(d.tag));
  const notes = String(parsed.notes || '').trim();

  return { add, remove, notes };
}

function markdownReport(report) {
  const lines = [];
  lines.push('# Blog tag audit (LLM)');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Shop: ${report.shop}`);
  lines.push(`- Blog: ${report.blogHandle}`);
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Model: ${report.model}`);
  lines.push(`- Confidence threshold: ${report.minConfidence}`);
  lines.push(`- Articles scanned: ${report.selectedCount}`);
  lines.push(`- Articles changed: ${report.changedCount}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Proposed adds (>= threshold): ${report.summary.proposedAdds}`);
  lines.push(`- Proposed removals (>= threshold): ${report.summary.proposedRemovals}`);
  lines.push(`- Applied updates: ${report.summary.appliedUpdates}`);
  lines.push(`- Failed: ${report.summary.failed}`);
  lines.push('');
  lines.push('## Top proposed additions');
  lines.push('');
  if (report.summary.topAdditions.length === 0) {
    lines.push('- None');
  } else {
    for (const item of report.summary.topAdditions) {
      lines.push(`- \`${item.tag}\`: ${item.count}`);
    }
  }
  lines.push('');
  lines.push('## Top proposed removals');
  lines.push('');
  if (report.summary.topRemovals.length === 0) {
    lines.push('- None');
  } else {
    for (const item of report.summary.topRemovals) {
      lines.push(`- \`${item.tag}\`: ${item.count}`);
    }
  }
  lines.push('');
  lines.push('## Per-article recommendations');
  lines.push('');
  for (const item of report.items) {
    lines.push(`### ${item.title}`);
    lines.push(`- ID: \`${item.id}\``);
    lines.push(`- Status: ${item.status}`);
    if (item.error) lines.push(`- Error: ${item.error}`);
    lines.push(`- Current tags: ${item.currentTags.join(', ') || '(none)'}`);
    lines.push(`- Recommended tags: ${item.recommendedTags.join(', ') || '(none)'}`);
    if (item.acceptedAdds.length > 0) {
      lines.push(`- Add: ${item.acceptedAdds.map((d) => `${d.tag} (${d.confidence})`).join(', ')}`);
    }
    if (item.acceptedRemoves.length > 0) {
      lines.push(`- Remove: ${item.acceptedRemoves.map((d) => `${d.tag} (${d.confidence})`).join(', ')}`);
    }
    if (item.notes) lines.push(`- Notes: ${item.notes}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

async function main() {
  const shop = normalizeShopDomain(RAW_SHOP);
  const targetArticleId = normalizeArticleId(articleIdArg);
  const backupDir = path.resolve(process.cwd(), backupDirArg);

  if (!shop || (!STATIC_ADMIN_TOKEN && (!CLIENT_ID || !CLIENT_SECRET))) {
    console.error([
      'Missing Shopify auth inputs.',
      'Set:',
      '  SHOPIFY_SHOP=<your-store>.myshopify.com',
      'And one auth mode:',
      '  A) SHOPIFY_ADMIN_ACCESS_TOKEN=<admin-api-access-token>',
      '  B) SHOPIFY_CLIENT_ID=<client-id>',
      '     SHOPIFY_CLIENT_SECRET=<client-secret>'
    ].join('\n'));
    process.exit(1);
  }

  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY. This script requires an LLM API key.');
    process.exit(1);
  }

  const blogs = await getBlogs(shop);
  const blog = blogs.find((b) => b.handle === blogHandleArg) || blogs[0];
  if (!blog) {
    console.error('No blogs found.');
    process.exit(1);
  }

  const allArticles = await getArticlesForBlog(shop, blog.id);
  let targets = allArticles;

  if (targetArticleId) {
    const specific = await getArticleById(shop, targetArticleId);
    if (!specific) {
      console.error(`Article not found: ${targetArticleId}`);
      process.exit(1);
    }
    targets = [specific];
  } else if (offsetArg > 0 || limitArg > 0) {
    targets = allArticles.slice(Math.max(0, offsetArg), limitArg > 0 ? Math.max(0, offsetArg) + limitArg : undefined);
  }

  if (targets.length === 0) {
    console.log('No target articles selected.');
    return;
  }

  const frequency = summarizeTagFrequency(allArticles);
  const vocabulary = frequency.map((item) => item.tag);
  const tagFrequencyMap = new Map(frequency.map((item) => [item.tag, item.count]));

  console.log(`Mode: ${applyChanges ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Blog: ${blog.handle}`);
  console.log(`Vocabulary size: ${vocabulary.length}`);
  console.log(`Articles selected: ${targets.length}`);
  console.log(`Model: ${OPENAI_MODEL}`);
  console.log(`Min confidence: ${minConfidence}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.mkdir(backupDir, { recursive: true });
  const jsonPath = path.join(backupDir, `blog-tag-audit-report-${timestamp}.json`);
  const mdPath = path.join(backupDir, `blog-tag-audit-report-${timestamp}.md`);

  const report = {
    generatedAt: new Date().toISOString(),
    shop,
    blogHandle: blog.handle,
    blogId: blog.id,
    mode: applyChanges ? 'apply' : 'dry-run',
    model: OPENAI_MODEL,
    minConfidence,
    selectedCount: targets.length,
    changedCount: 0,
    vocabulary,
    items: [],
    summary: {
      proposedAdds: 0,
      proposedRemovals: 0,
      appliedUpdates: 0,
      failed: 0,
      topAdditions: [],
      topRemovals: []
    }
  };

  const additionCounts = new Map();
  const removalCounts = new Map();

  for (let i = 0; i < targets.length; i += 1) {
    const article = targets[i];
    const item = {
      index: i + 1,
      id: article.id,
      title: article.title,
      handle: article.handle,
      currentTags: unique(article.tags || []),
      llmAdd: [],
      llmRemove: [],
      acceptedAdds: [],
      acceptedRemoves: [],
      recommendedTags: [],
      notes: '',
      status: 'pending'
    };
    report.items.push(item);

    try {
      console.log(`[${i + 1}/${targets.length}] Auditing tags: ${article.title}`);
      const llm = await llmAuditTagsForArticle(article, vocabulary, tagFrequencyMap);
      item.llmAdd = llm.add;
      item.llmRemove = llm.remove;
      item.notes = llm.notes;

      const resolved = resolveTagChanges(item.currentTags, llm.add, llm.remove, minConfidence);
      item.acceptedAdds = resolved.acceptedAdds;
      item.acceptedRemoves = resolved.acceptedRemoves;
      item.recommendedTags = unique(resolved.nextTags);

      for (const add of item.acceptedAdds) {
        report.summary.proposedAdds += 1;
        additionCounts.set(add.tag, (additionCounts.get(add.tag) || 0) + 1);
      }
      for (const rem of item.acceptedRemoves) {
        report.summary.proposedRemovals += 1;
        removalCounts.set(rem.tag, (removalCounts.get(rem.tag) || 0) + 1);
      }

      const changed = !tagsEqual(item.currentTags, item.recommendedTags);
      if (changed) report.changedCount += 1;

      if (applyChanges && changed) {
        const update = await updateArticleTags(shop, article.id, item.recommendedTags);
        if (update.userErrors?.length) {
          throw new Error(`Shopify userErrors: ${JSON.stringify(update.userErrors)}`);
        }
        report.summary.appliedUpdates += 1;
        item.status = 'updated';
      } else {
        item.status = changed ? 'review-change' : 'no-change';
      }
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : String(error);
      report.summary.failed += 1;
      console.error(`  failed: ${item.error}`);
    }
  }

  report.summary.topAdditions = [...additionCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([tag, count]) => ({ tag, count }));

  report.summary.topRemovals = [...removalCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([tag, count]) => ({ tag, count }));

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, markdownReport(report), 'utf8');

  console.log('');
  console.log('Done.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);
  console.log(`Changed articles: ${report.changedCount}/${report.selectedCount}`);
  console.log(`Proposed adds: ${report.summary.proposedAdds}`);
  console.log(`Proposed removals: ${report.summary.proposedRemovals}`);
  console.log(`Applied updates: ${report.summary.appliedUpdates}`);
  console.log(`Failed: ${report.summary.failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
