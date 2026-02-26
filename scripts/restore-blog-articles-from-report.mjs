#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const RAW_SHOP = (process.env.SHOPIFY_SHOP || '').trim();
const STATIC_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();
const API_VERSION = (process.env.SHOPIFY_API_VERSION || '2025-10').trim();

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const reportPathArg = (getArg('report') || '').trim();
const onlyUpdated = !args.includes('--include-previewed');

function normalizeShopDomain(input) {
  const raw = (input || '').trim();
  if (!raw) return '';
  let host = raw.replace(/^https?:\/\//i, '').split('/')[0].trim();
  if (!host) return '';
  if (!host.includes('.')) host = `${host}.myshopify.com`;
  return host;
}

let oauthAccessToken = null;
let oauthAccessTokenExpiresAt = 0;

async function getShopifyAccessToken(shop) {
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
  const token = await getShopifyAccessToken(shop);
  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });

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

async function updateArticleBody(shop, articleId, body) {
  const mutation = `
    mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id title }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL(shop, mutation, { id: articleId, article: { body } });
  return data.articleUpdate;
}

async function main() {
  const shop = normalizeShopDomain(RAW_SHOP);
  const reportPath = path.resolve(process.cwd(), reportPathArg);

  if (!shop || (!STATIC_ADMIN_TOKEN && (!CLIENT_ID || !CLIENT_SECRET)) || !reportPathArg) {
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
        '  node scripts/restore-blog-articles-from-report.mjs --report=<path-to-report-json>'
      ].join('\n')
    );
    process.exit(1);
  }

  const raw = await fs.readFile(reportPath, 'utf8');
  const report = JSON.parse(raw);
  const items = Array.isArray(report.items) ? report.items : [];
  const candidates = items.filter((item) => {
    if (!item.id || typeof item.beforeBody !== 'string') return false;
    if (onlyUpdated) return item.status === 'updated';
    return item.status === 'updated' || item.status === 'previewed';
  });

  if (candidates.length === 0) {
    console.log('No restorable entries found in report.');
    return;
  }

  console.log(`Restoring ${candidates.length} articles from ${reportPath}...`);
  let restored = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i];
    try {
      const result = await updateArticleBody(shop, item.id, item.beforeBody);
      if (result.userErrors?.length) {
        throw new Error(JSON.stringify(result.userErrors));
      }
      restored += 1;
      console.log(`[${i + 1}/${candidates.length}] restored: ${item.id}`);
    } catch (error) {
      failed += 1;
      console.error(`[${i + 1}/${candidates.length}] failed: ${item.id} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`Done. restored=${restored}, failed=${failed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

