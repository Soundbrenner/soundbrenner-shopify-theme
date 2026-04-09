#!/usr/bin/env node

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const FROM_YEAR = `${process.env.FROM_YEAR || "2025"}`.trim();
const TO_YEAR = `${process.env.TO_YEAR || "2026"}`.trim();
const HANDLE_STRATEGY = `${process.env.HANDLE_STRATEGY || "remove-year"}`.trim();
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const REDIRECT_NEW_HANDLE = process.env.REDIRECT_NEW_HANDLE !== "false";

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

if (!["remove-year", "replace-year", "keep"].includes(HANDLE_STRATEGY)) {
  console.error('HANDLE_STRATEGY must be one of: "remove-year", "replace-year", "keep".');
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceStandaloneYear(value, fromYear, toYear) {
  const pattern = new RegExp(`(?<!\\d)${escapeRegExp(fromYear)}(?!\\d)`, "g");
  return `${value || ""}`.replace(pattern, toYear);
}

function replaceYearInHtmlTextOnly(value, fromYear, toYear) {
  const source = `${value || ""}`;
  if (!source) return source;

  const urlPlaceholders = [];
  const protectedSource = source.replace(
    /\bhttps?:\/\/[^\s"'<>]+/gi,
    (match) => {
      const placeholder = `__SB_URL_${urlPlaceholders.length}__`;
      urlPlaceholders.push(match);
      return placeholder;
    }
  );

  const replaced = replaceStandaloneYear(protectedSource, fromYear, toYear);

  return replaced.replace(/__SB_URL_(\d+)__/g, (_, index) => {
    const resolved = urlPlaceholders[Number.parseInt(index, 10)];
    return typeof resolved === "string" ? resolved : _;
  });
}

function normalizeHandle(handle) {
  return handle
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildUpdatedHandle(handle) {
  const source = `${handle || ""}`;

  if (!source) return source;
  if (HANDLE_STRATEGY === "keep") return source;
  if (HANDLE_STRATEGY === "replace-year") {
    return normalizeHandle(
      source.replace(
        new RegExp(`(^|-)${escapeRegExp(FROM_YEAR)}(?=-|$)`, "g"),
        `$1${TO_YEAR}`
      )
    );
  }

  return normalizeHandle(
    source
      .replace(new RegExp(`-in-${escapeRegExp(FROM_YEAR)}(?=-|$)`, "g"), "")
      .replace(new RegExp(`(^|-)${escapeRegExp(FROM_YEAR)}(?=-|$)`, "g"), "$1")
  );
}

function countOccurrences(value, year) {
  const pattern = new RegExp(escapeRegExp(year), "g");
  return (`${value || ""}`.match(pattern) || []).length;
}

async function loadArticles(accessToken) {
  const query = `
    query ArticlesWithYear($first: Int!, $after: String, $search: String!) {
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
          blog {
            id
            handle
            title
          }
        }
      }
    }
  `;

  const allArticles = [];
  let after = null;

  do {
    const data = await runShopifyGraphQL(accessToken, query, {
      first: 100,
      after,
      search: `title:*${FROM_YEAR}*`,
    });

    const connection = data?.articles;
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    allArticles.push(...nodes);
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);

  return allArticles;
}

async function updateArticle(accessToken, article) {
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

  return runShopifyGraphQL(accessToken, mutation, article);
}

async function main() {
  log("Fetching Shopify access token");
  const accessToken = await getShopifyAccessToken();

  log("Loading articles with matching titles", `year=${FROM_YEAR}`);
  const articles = await loadArticles(accessToken);

  if (articles.length === 0) {
    log("No matching articles found");
    return;
  }

  const existingHandles = new Set(articles.map((article) => article.handle));
  const handlePlan = new Map();

  for (const article of articles) {
    const nextHandle = buildUpdatedHandle(article.handle);

    if (nextHandle !== article.handle && existingHandles.has(nextHandle)) {
      const ownerId = handlePlan.get(nextHandle);
      if (!ownerId || ownerId !== article.id) {
        throw new Error(
          `Handle collision detected for "${nextHandle}" while processing "${article.title}".`
        );
      }
    }

    handlePlan.set(nextHandle, article.id);
  }

  const updates = articles.map((article) => {
    const nextTitle = replaceStandaloneYear(article.title, FROM_YEAR, TO_YEAR);
    const nextBody = replaceYearInHtmlTextOnly(article.body, FROM_YEAR, TO_YEAR);
    const nextSummary = replaceYearInHtmlTextOnly(article.summary, FROM_YEAR, TO_YEAR);
    const nextHandle = buildUpdatedHandle(article.handle);

    const articleInput = {};

    if (nextTitle !== article.title) {
      articleInput.title = nextTitle;
    }

    if (nextBody !== article.body) {
      articleInput.body = nextBody;
    }

    if (nextSummary !== article.summary) {
      articleInput.summary = nextSummary;
    }

    if (nextHandle !== article.handle) {
      articleInput.handle = nextHandle;
      if (REDIRECT_NEW_HANDLE) {
        articleInput.redirectNewHandle = true;
      }
    }

    return {
      id: article.id,
      blogHandle: article.blog.handle,
      title: article.title,
      handle: article.handle,
      nextTitle,
      nextHandle,
      titleChanged: nextTitle !== article.title,
      bodyMatches: countOccurrences(article.body, FROM_YEAR),
      summaryMatches: countOccurrences(article.summary, FROM_YEAR),
      input: articleInput,
    };
  });

  const actionableUpdates = updates.filter((update) => Object.keys(update.input).length > 0);

  log(
    "Prepared article updates",
    `count=${actionableUpdates.length}, dryRun=${DRY_RUN}, handleStrategy=${HANDLE_STRATEGY}`
  );

  for (const update of actionableUpdates) {
    log(
      "Planned update",
      JSON.stringify({
        title: update.title,
        nextTitle: update.nextTitle,
        handle: update.handle,
        nextHandle: update.nextHandle,
        bodyMatches: update.bodyMatches,
        summaryMatches: update.summaryMatches,
      })
    );
  }

  if (DRY_RUN) {
    log("Dry run complete");
    return;
  }

  let successCount = 0;

  for (const update of actionableUpdates) {
    log("Updating article", `${update.title} -> ${update.nextTitle}`);
    const data = await updateArticle(accessToken, {
      id: update.id,
      article: update.input,
    });

    const result = data?.articleUpdate;
    const userErrors = Array.isArray(result?.userErrors) ? result.userErrors : [];

    if (userErrors.length > 0) {
      throw new Error(
        `Failed to update "${update.title}": ${JSON.stringify(userErrors)}`
      );
    }

    successCount += 1;
  }

  log("Article year update complete", `updated=${successCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
