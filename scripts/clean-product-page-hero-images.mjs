#!/usr/bin/env node

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const METAOBJECT_TYPE = process.env.SHOPIFY_METAOBJECT_TYPE || "sbv2_product_page_header";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const LIMIT = Number.parseInt(process.env.LIMIT || "", 10);

const VIDEO_KEYS = (process.env.VIDEO_KEYS || "video_url,video_url_mobile")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

const IMAGE_KEYS = (
  process.env.IMAGE_KEYS
  || "image_url,image_url_mobile,image_desktop,image_mobile,background_image_desktop,background_image_mobile"
)
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

const hasAdminAccessToken =
  typeof process.env.SHOPIFY_ADMIN_ACCESS_TOKEN === "string"
  && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN.trim() !== "";

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

async function fetchAllMetaobjects(accessToken) {
  const query = `
    query ListMetaobjects($type: String!, $cursor: String) {
      metaobjects(type: $type, first: 100, after: $cursor) {
        nodes {
          id
          handle
          fields {
            key
            value
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const nodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await runShopifyGraphQL(accessToken, query, {
      type: METAOBJECT_TYPE,
      cursor,
    });

    const connection = data?.metaobjects;
    const pageNodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    nodes.push(...pageNodes);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor || null;
  }

  return nodes;
}

function getFieldValueMap(metaobject) {
  const map = new Map();
  const fields = Array.isArray(metaobject?.fields) ? metaobject.fields : [];
  for (const field of fields) {
    if (!field?.key) continue;
    map.set(field.key, `${field.value || ""}`.trim());
  }
  return map;
}

function hasNonEmptyField(fieldMap, key) {
  return Boolean((fieldMap.get(key) || "").trim());
}

async function updateMetaobjectFields(accessToken, metaobjectId, fields) {
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

  const data = await runShopifyGraphQL(accessToken, mutation, {
    id: metaobjectId,
    metaobject: { fields },
  });

  const errors = data?.metaobjectUpdate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(`metaobjectUpdate userErrors: ${JSON.stringify(errors)}`);
  }
}

async function main() {
  log(
    "Starting hero image cleanup",
    `type=${METAOBJECT_TYPE} dry_run=${DRY_RUN} video_keys=${VIDEO_KEYS.join("|")} image_keys=${IMAGE_KEYS.join("|")}`
  );
  const accessToken = await getShopifyAccessToken();
  const metaobjects = await fetchAllMetaobjects(accessToken);

  if (!metaobjects.length) {
    log(`No entries found for "${METAOBJECT_TYPE}"`);
    return;
  }

  log(`Found ${metaobjects.length} "${METAOBJECT_TYPE}" entries`);

  const candidates = [];
  for (const metaobject of metaobjects) {
    const fieldMap = getFieldValueMap(metaobject);
    const hasVideo = VIDEO_KEYS.some((key) => hasNonEmptyField(fieldMap, key));
    if (!hasVideo) continue;

    const imageKeysToClear = IMAGE_KEYS.filter((key) => hasNonEmptyField(fieldMap, key));
    if (!imageKeysToClear.length) continue;

    candidates.push({
      id: metaobject.id,
      handle: metaobject.handle || metaobject.id,
      imageKeysToClear,
    });
  }

  if (!candidates.length) {
    log("No hero entries had both video and image fields populated");
    return;
  }

  const selectedCandidates = Number.isFinite(LIMIT) && LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;
  if (selectedCandidates.length !== candidates.length) {
    log("Applying candidate limit", `${selectedCandidates.length}/${candidates.length}`);
  }

  log("Entries with both video and image populated", `${selectedCandidates.length}`);
  let updated = 0;
  let failed = 0;

  for (const candidate of selectedCandidates) {
    if (DRY_RUN) {
      log("Dry run clear", `${candidate.handle}: ${candidate.imageKeysToClear.join(", ")}`);
      updated += 1;
      continue;
    }

    const fields = candidate.imageKeysToClear.map((key) => ({
      key,
      value: "",
    }));

    try {
      await updateMetaobjectFields(accessToken, candidate.id, fields);
      log("Updated", `${candidate.handle}: cleared ${candidate.imageKeysToClear.join(", ")}`);
      updated += 1;
    } catch (error) {
      failed += 1;
      log("Failed", `${candidate.handle}: ${error.message}`);
    }
  }

  log("Cleanup summary", `updated=${updated} failed=${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
