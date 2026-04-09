#!/usr/bin/env node

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const BROKEN_YEAR = `${process.env.BROKEN_YEAR || "2026"}`.trim();
const SOURCE_YEAR = `${process.env.SOURCE_YEAR || "2025"}`.trim();
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const UPDATED_AFTER = `${process.env.UPDATED_AFTER || "2026-04-09T03:09:00Z"}`.trim();

const hasAdminAccessToken =
  typeof process.env.SHOPIFY_ADMIN_ACCESS_TOKEN === "string" &&
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN.trim() !== "";

const requiredEnv = hasAdminAccessToken
  ? ["SHOPIFY_SHOP_DOMAIN"]
  : ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"];

const missingEnv = requiredEnv.filter((name) => {
  const value = process.env[name];
  return typeof value !== "string" || value.trim() === "";
});

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const config = {
  shopDomain: process.env.SHOPIFY_SHOP_DOMAIN.trim(),
  shopifyClientId: (process.env.SHOPIFY_CLIENT_ID || "").trim(),
  shopifyClientSecret: (process.env.SHOPIFY_CLIENT_SECRET || "").trim(),
  shopifyAdminAccessToken: (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim(),
};

function log(message, extra = "") {
  const now = new Date().toISOString();
  if (extra) {
    console.log(`[${now}] ${message} ${extra}`);
  } else {
    console.log(`[${now}] ${message}`);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const responseText = await response.text();
  let data = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
    error.status = response.status;
    error.data = data;
    error.body = responseText;
    throw error;
  }

  if (data === null) {
    throw new Error(`Expected JSON response from ${url}`);
  }

  return data;
}

async function getShopifyAccessToken() {
  if (config.shopifyAdminAccessToken) {
    return config.shopifyAdminAccessToken;
  }

  const url = `https://${config.shopDomain}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.shopifyClientId,
    client_secret: config.shopifyClientSecret,
  });

  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const token = data.access_token;
  if (!token) {
    throw new Error("Shopify access token response missing access_token");
  }

  return token;
}

async function runShopifyGraphQL(accessToken, query, variables = {}) {
  const url = `https://${config.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const payload = { query, variables };

  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify(payload),
  });

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

async function loadRecentlyUpdatedArticles(accessToken) {
  const query = `
    query ArticlesUpdatedAfter($first: Int!, $after: String, $search: String!) {
      articles(first: $first, after: $after, query: $search) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
          body
          summary
          updatedAt
        }
      }
    }
  `;

  const articles = [];
  let after = null;

  do {
    const data = await runShopifyGraphQL(accessToken, query, {
      first: 100,
      after,
      search: `updated_at:>='${UPDATED_AFTER}'`,
    });

    const connection = data?.articles;
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    articles.push(...nodes);
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);

  return articles;
}

function collectBrokenShopifyUrls(content) {
  const value = `${content || ""}`;
  const urls = value.match(/\bhttps:\/\/cdn\.shopify\.com\/s\/files\/[^\s"'<>]*\b/gi) || [];
  return [...new Set(urls.filter((url) => url.includes(BROKEN_YEAR)))];
}

function buildUrlRepairs(urls) {
  const replacements = new Map();

  for (const url of urls) {
    const candidate = url.replaceAll(BROKEN_YEAR, SOURCE_YEAR);
    if (candidate === url) continue;
    replacements.set(url, candidate);
  }

  return replacements;
}

function applyReplacements(content, replacements) {
  let value = `${content || ""}`;

  for (const [fromUrl, toUrl] of replacements.entries()) {
    value = value.split(fromUrl).join(toUrl);
  }

  return value;
}

async function updateArticle(accessToken, id, article) {
  const mutation = `
    mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article {
          id
          title
          handle
          updatedAt
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  return runShopifyGraphQL(accessToken, mutation, { id, article });
}

async function main() {
  log("Fetching Shopify access token");
  const accessToken = await getShopifyAccessToken();

  log("Loading recently updated articles", `updatedAfter=${UPDATED_AFTER}`);
  const articles = await loadRecentlyUpdatedArticles(accessToken);

  const plans = [];

  for (const article of articles) {
    const urls = [
      ...collectBrokenShopifyUrls(article.body),
      ...collectBrokenShopifyUrls(article.summary),
    ];

    if (urls.length === 0) continue;

    const uniqueUrls = [...new Set(urls)];
    const replacements = buildUrlRepairs(uniqueUrls);
    if (replacements.size === 0) continue;

    const nextBody = applyReplacements(article.body, replacements);
    const nextSummary = applyReplacements(article.summary, replacements);
    const articleInput = {};

    if (nextBody !== article.body) {
      articleInput.body = nextBody;
    }

    if (nextSummary !== article.summary) {
      articleInput.summary = nextSummary;
    }

    if (Object.keys(articleInput).length === 0) continue;

    plans.push({
      id: article.id,
      title: article.title,
      handle: article.handle,
      replacementCount: replacements.size,
      replacements: [...replacements.entries()],
      input: articleInput,
    });
  }

  log("Prepared media URL repairs", `count=${plans.length}, dryRun=${DRY_RUN}`);

  for (const plan of plans) {
    log(
      "Planned repair",
      JSON.stringify({
        title: plan.title,
        handle: plan.handle,
        replacementCount: plan.replacementCount,
      })
    );
  }

  if (DRY_RUN) {
    log("Dry run complete");
    return;
  }

  let repaired = 0;

  for (const plan of plans) {
    log("Repairing article media URLs", plan.title);
    const data = await updateArticle(accessToken, plan.id, plan.input);
    const userErrors = data?.articleUpdate?.userErrors || [];

    if (userErrors.length > 0) {
      throw new Error(
        `Failed to repair "${plan.title}": ${JSON.stringify(userErrors)}`
      );
    }

    repaired += 1;
  }

  log("Media URL repair complete", `updated=${repaired}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
