#!/usr/bin/env node

const DEFAULT_INTERVAL_MS = 60_000;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const SHOPIFY_METAOBJECT_TYPE = process.env.SHOPIFY_METAOBJECT_TYPE || "trustpilot";
const SHOPIFY_METAOBJECT_HANDLE = process.env.SHOPIFY_METAOBJECT_HANDLE || "";
const FIELD_RATING =
  process.env.SHOPIFY_FIELD_COMBINED_RATING || "combined_klaviyo_product_review_ratings";
const FIELD_COUNT =
  process.env.SHOPIFY_FIELD_COMBINED_COUNT || "combined_klaviyo_product_review_count";
const KLAVIYO_REVISION = process.env.KLAVIYO_REVISION || "2026-01-15";
const KLAVIYO_CLIENT_GROUP_BY = process.env.KLAVIYO_CLIENT_GROUP_BY || "company_id";
const KLAVIYO_CLIENT_TIMEFRAME = process.env.KLAVIYO_CLIENT_TIMEFRAME || "all_time";

const requiredEnv = [
  "SHOPIFY_SHOP_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "KLAVIYO_PRIVATE_API_KEY",
];

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
  shopifyClientId: process.env.SHOPIFY_CLIENT_ID.trim(),
  shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET.trim(),
  klaviyoApiKey: process.env.KLAVIYO_PRIVATE_API_KEY.trim(),
  klaviyoCompanyId: (process.env.KLAVIYO_COMPANY_ID || "").trim(),
  intervalMs: Number.parseInt(process.env.INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`, 10),
  dryRun: process.env.DRY_RUN === "true",
  once: process.argv.includes("--once") || process.env.RUN_ONCE === "true",
};

if (!Number.isFinite(config.intervalMs) || config.intervalMs < 10_000) {
  console.error("INTERVAL_MS must be a number >= 10000.");
  process.exit(1);
}

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
    const error = new Error(
      `HTTP ${response.status} ${response.statusText} (${url})`
    );
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

async function getTrustpilotMetaobject(accessToken) {
  if (SHOPIFY_METAOBJECT_HANDLE) {
    const query = `
      query MetaobjectByHandle($handle: MetaobjectHandleInput!) {
        metaobjectByHandle(handle: $handle) {
          id
          type
          handle
          fields {
            key
            value
          }
        }
      }
    `;
    const data = await runShopifyGraphQL(accessToken, query, {
      handle: {
        type: SHOPIFY_METAOBJECT_TYPE,
        handle: SHOPIFY_METAOBJECT_HANDLE,
      },
    });

    if (data?.metaobjectByHandle) return data.metaobjectByHandle;
    throw new Error(
      `No metaobject found for ${SHOPIFY_METAOBJECT_TYPE}/${SHOPIFY_METAOBJECT_HANDLE}`
    );
  }

  const query = `
    query FirstMetaobject($type: String!) {
      metaobjects(type: $type, first: 1) {
        nodes {
          id
          type
          handle
          fields {
            key
            value
          }
        }
      }
    }
  `;

  const data = await runShopifyGraphQL(accessToken, query, {
    type: SHOPIFY_METAOBJECT_TYPE,
  });
  const node = data?.metaobjects?.nodes?.[0];
  if (!node) {
    throw new Error(`No metaobject entries found for type "${SHOPIFY_METAOBJECT_TYPE}"`);
  }
  return node;
}

function normalizeRating(value) {
  if (!Number.isFinite(value)) return "0";
  const clamped = Math.max(0, Math.min(5, value));
  const fixed = clamped.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
}

function normalizeCount(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.max(0, Math.round(value));
  return `${rounded}`;
}

function findNumericByKeyDeep(input, targetKeys) {
  const keys = new Set(targetKeys);
  const seen = new Set();

  const walk = (node) => {
    if (node === null || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found !== null) return found;
      }
      return null;
    }

    for (const [key, value] of Object.entries(node)) {
      if (keys.has(key)) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
    }

    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found !== null) return found;
    }
    return null;
  };

  return walk(input);
}

async function getKlaviyoCompanyId() {
  if (config.klaviyoCompanyId) return config.klaviyoCompanyId;

  const data = await fetchJson("https://a.klaviyo.com/api/accounts", {
    headers: {
      Authorization: `Klaviyo-API-Key ${config.klaviyoApiKey}`,
      accept: "application/vnd.api+json",
      revision: KLAVIYO_REVISION,
    },
  });

  const first = data?.data?.[0];
  const companyId = first?.id || first?.attributes?.public_api_key;
  if (!companyId) {
    throw new Error("Unable to resolve Klaviyo company_id from /api/accounts");
  }

  return companyId;
}

async function tryKlaviyoClientAggregate(companyId) {
  const url = new URL("https://a.klaviyo.com/client/review-values-reports/");
  url.searchParams.set("company_id", companyId);
  url.searchParams.set("group_by", KLAVIYO_CLIENT_GROUP_BY);
  url.searchParams.set("timeframe", KLAVIYO_CLIENT_TIMEFRAME);
  url.searchParams.set("statistics", "average_rating,total_reviews");

  const data = await fetchJson(url.toString(), {
    headers: {
      Authorization: `Klaviyo-API-Key ${config.klaviyoApiKey}`,
      accept: "application/vnd.api+json",
      revision: KLAVIYO_REVISION,
    },
  });

  const averageRating = findNumericByKeyDeep(data, [
    "average_rating",
    "averageRating",
    "avg_rating",
    "avgRating",
  ]);
  const totalReviews = findNumericByKeyDeep(data, [
    "total_reviews",
    "totalReviews",
    "review_count",
    "reviewCount",
    "reviews_count",
    "reviewsCount",
    "count",
  ]);

  if (!Number.isFinite(averageRating) || !Number.isFinite(totalReviews)) {
    throw new Error("Klaviyo client aggregate response missing average_rating/total_reviews");
  }

  return {
    source: "klaviyo_client_review_values_reports",
    averageRating,
    totalReviews,
  };
}

async function computeFromKlaviyoPublishedReviews() {
  let nextUrl = "https://a.klaviyo.com/api/reviews?page[size]=100&filter=equals(status,%22published%22)";
  let totalReviews = 0;
  let ratingSum = 0;
  let pages = 0;

  while (nextUrl) {
    const data = await fetchJson(nextUrl, {
      headers: {
        Authorization: `Klaviyo-API-Key ${config.klaviyoApiKey}`,
        accept: "application/vnd.api+json",
        revision: KLAVIYO_REVISION,
      },
    });

    const rows = Array.isArray(data?.data) ? data.data : [];
    for (const row of rows) {
      const rating = Number(row?.attributes?.rating);
      if (!Number.isFinite(rating)) continue;
      totalReviews += 1;
      ratingSum += rating;
    }

    pages += 1;
    if (pages % 20 === 0) {
      log("Klaviyo pagination progress:", `${pages} pages`);
    }

    const maybeNext = data?.links?.next;
    nextUrl = typeof maybeNext === "string" && maybeNext.length > 0 ? maybeNext : "";
  }

  const averageRating = totalReviews > 0 ? ratingSum / totalReviews : 0;
  return {
    source: "klaviyo_reviews_api_fallback",
    averageRating,
    totalReviews,
  };
}

async function getReviewAggregates() {
  const companyId = await getKlaviyoCompanyId();

  try {
    return await tryKlaviyoClientAggregate(companyId);
  } catch (error) {
    const status = Number(error?.status || 0);
    const detail =
      error?.data?.errors?.[0]?.detail ||
      error?.data?.errors?.[0]?.title ||
      error?.message ||
      "unknown error";

    log(
      "Klaviyo client aggregate unavailable; falling back to /api/reviews compute:",
      `status=${status || "n/a"} detail=${detail}`
    );
    return await computeFromKlaviyoPublishedReviews();
  }
}

function getCurrentFieldMap(metaobject) {
  const map = new Map();
  const fields = Array.isArray(metaobject?.fields) ? metaobject.fields : [];
  for (const field of fields) {
    if (!field?.key) continue;
    map.set(field.key, field.value == null ? "" : `${field.value}`);
  }
  return map;
}

async function updateMetaobjectFields(accessToken, metaobjectId, ratingValue, countValue) {
  const mutation = `
    mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
          handle
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const variables = {
    id: metaobjectId,
    metaobject: {
      fields: [
        { key: FIELD_RATING, value: ratingValue },
        { key: FIELD_COUNT, value: countValue },
      ],
    },
  };

  const data = await runShopifyGraphQL(accessToken, mutation, variables);
  const errors = data?.metaobjectUpdate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(`metaobjectUpdate userErrors: ${JSON.stringify(errors)}`);
  }
  return data?.metaobjectUpdate?.metaobject;
}

async function runSync() {
  log("Sync started");

  const aggregate = await getReviewAggregates();
  const ratingValue = normalizeRating(aggregate.averageRating);
  const countValue = normalizeCount(aggregate.totalReviews);

  log(
    "Aggregate resolved:",
    `source=${aggregate.source} rating=${ratingValue} count=${countValue}`
  );

  const shopifyToken = await getShopifyAccessToken();
  const metaobject = await getTrustpilotMetaobject(shopifyToken);
  const currentFields = getCurrentFieldMap(metaobject);
  const currentRating = currentFields.get(FIELD_RATING) || "";
  const currentCount = currentFields.get(FIELD_COUNT) || "";

  const changed = currentRating !== ratingValue || currentCount !== countValue;
  if (!changed) {
    log(
      "No update needed:",
      `metaobject=${metaobject.handle} rating=${currentRating} count=${currentCount}`
    );
    return;
  }

  if (config.dryRun) {
    log(
      "Dry run update:",
      `metaobject=${metaobject.handle} ${FIELD_RATING} ${currentRating} -> ${ratingValue}, ${FIELD_COUNT} ${currentCount} -> ${countValue}`
    );
    return;
  }

  await updateMetaobjectFields(shopifyToken, metaobject.id, ratingValue, countValue);
  log(
    "Metaobject updated:",
    `metaobject=${metaobject.handle} rating=${ratingValue} count=${countValue}`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop() {
  if (config.once) {
    await runSync();
    return;
  }

  while (true) {
    try {
      await runSync();
    } catch (error) {
      const detail =
        error?.data?.errors?.[0]?.detail ||
        error?.data?.errors?.[0]?.title ||
        error?.message ||
        String(error);
      log("Sync failed:", detail);
    }

    await sleep(config.intervalMs);
  }
}

runLoop().catch((error) => {
  const detail =
    error?.data?.errors?.[0]?.detail ||
    error?.data?.errors?.[0]?.title ||
    error?.message ||
    String(error);
  console.error(detail);
  process.exit(1);
});
