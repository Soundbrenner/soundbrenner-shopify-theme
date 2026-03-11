#!/usr/bin/env node

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const LARGE_FEATURE_TYPE = process.env.LARGE_FEATURE_METAOBJECT_TYPE || "sbv2_large_photo_video_feature";
const FEATURE_CAROUSEL_ITEM_TYPE =
  process.env.FEATURE_CAROUSEL_ITEM_METAOBJECT_TYPE || "sbv2_features_carousel_item";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";

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

function isBlank(value) {
  return `${value || ""}`.trim() === "";
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (!isBlank(value)) return `${value}`;
  }
  return "";
}

function getFieldMap(metaobject) {
  const map = new Map();
  const fields = Array.isArray(metaobject?.fields) ? metaobject.fields : [];
  for (const field of fields) {
    if (!field?.key) continue;
    map.set(field.key, `${field.value || ""}`);
  }
  return map;
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
  if (config.shopifyAdminAccessToken) return config.shopifyAdminAccessToken;

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

async function getDefinitionByType(accessToken, type) {
  const query = `
    query GetMetaobjectDefinition($type: String!) {
      metaobjectDefinitionByType(type: $type) {
        id
        type
        fieldDefinitions {
          key
          name
          required
          description
          type {
            name
          }
          validations {
            name
            value
          }
        }
      }
    }
  `;
  const data = await runShopifyGraphQL(accessToken, query, { type });
  return data?.metaobjectDefinitionByType || null;
}

async function updateDefinition(accessToken, definitionId, definitionInput) {
  const mutation = `
    mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
      metaobjectDefinitionUpdate(id: $id, definition: $definition) {
        metaobjectDefinition {
          id
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
    id: definitionId,
    definition: definitionInput,
  });

  const errors = data?.metaobjectDefinitionUpdate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(`metaobjectDefinitionUpdate userErrors: ${JSON.stringify(errors)}`);
  }
}

async function ensureFieldsOnDefinition(accessToken, type, fieldsToAdd) {
  const definition = await getDefinitionByType(accessToken, type);
  if (!definition?.id) {
    throw new Error(`Metaobject definition not found for type "${type}"`);
  }

  const existingKeys = new Set(
    (definition.fieldDefinitions || [])
      .map((field) => field?.key)
      .filter(Boolean)
  );

  const missing = fieldsToAdd.filter((field) => !existingKeys.has(field.key));
  if (!missing.length) {
    log(`Definition already has unified media fields for ${type}`);
    return;
  }

  log(`Adding missing unified media fields for ${type}`, missing.map((field) => field.key).join(", "));
  if (DRY_RUN) return;

  const createOperations = missing.map((field) => ({
    create: {
      key: field.key,
      name: field.name,
      description: field.description || "",
      required: false,
      type: "file_reference",
    },
  }));

  await updateDefinition(accessToken, definition.id, { fieldDefinitions: createOperations });
}

async function fetchAllMetaobjects(accessToken, type) {
  const query = `
    query GetMetaobjects($type: String!, $cursor: String) {
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
    const data = await runShopifyGraphQL(accessToken, query, { type, cursor });
    const connection = data?.metaobjects;
    const batch = Array.isArray(connection?.nodes) ? connection.nodes : [];
    nodes.push(...batch);
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor || null;
  }

  return nodes;
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

async function migrateLargeFeatureEntries(accessToken) {
  const entries = await fetchAllMetaobjects(accessToken, LARGE_FEATURE_TYPE);
  let touched = 0;
  let skipped = 0;

  for (const entry of entries) {
    const fieldMap = getFieldMap(entry);
    const mediaValue = fieldMap.get("media") || "";
    if (!isBlank(mediaValue)) {
      skipped += 1;
      continue;
    }

    const legacyValue = firstNonBlank(fieldMap.get("video_url"), fieldMap.get("image"));
    if (isBlank(legacyValue)) {
      skipped += 1;
      continue;
    }

    touched += 1;
    log("Large feature backfill", `${entry.handle || entry.id}: media <= legacy`);
    if (!DRY_RUN) {
      await updateMetaobjectFields(accessToken, entry.id, [{ key: "media", value: legacyValue }]);
    }
  }

  return { total: entries.length, touched, skipped };
}

async function migrateFeatureCarouselEntries(accessToken) {
  const entries = await fetchAllMetaobjects(accessToken, FEATURE_CAROUSEL_ITEM_TYPE);
  let touched = 0;
  let skipped = 0;

  for (const entry of entries) {
    const fieldMap = getFieldMap(entry);
    const mediaValue = fieldMap.get("media") || "";
    if (!isBlank(mediaValue)) {
      skipped += 1;
      continue;
    }

    const legacyValue = firstNonBlank(fieldMap.get("video_url"), fieldMap.get("image"));
    if (isBlank(legacyValue)) {
      skipped += 1;
      continue;
    }

    touched += 1;
    log("Feature carousel backfill", `${entry.handle || entry.id}: media <= legacy`);
    if (!DRY_RUN) {
      await updateMetaobjectFields(accessToken, entry.id, [{ key: "media", value: legacyValue }]);
    }
  }

  return { total: entries.length, touched, skipped };
}

async function main() {
  log("Starting unified media migration", DRY_RUN ? "(dry run)" : "(write mode)");
  const accessToken = await getShopifyAccessToken();

  await ensureFieldsOnDefinition(accessToken, LARGE_FEATURE_TYPE, [
    { key: "media", name: "Media" },
  ]);
  await ensureFieldsOnDefinition(accessToken, FEATURE_CAROUSEL_ITEM_TYPE, [
    {
      key: "media",
      name: "Media",
      description: "Photo or video media for feature carousel item",
    },
  ]);

  const largeFeatureStats = await migrateLargeFeatureEntries(accessToken);
  const featureCarouselStats = await migrateFeatureCarouselEntries(accessToken);

  log(
    "Large feature result",
    `total=${largeFeatureStats.total}, updated=${largeFeatureStats.touched}, skipped=${largeFeatureStats.skipped}`
  );
  log(
    "Feature carousel result",
    `total=${featureCarouselStats.total}, updated=${featureCarouselStats.touched}, skipped=${featureCarouselStats.skipped}`
  );
  log("Unified media migration complete");
}

main().catch((error) => {
  console.error("Unified media migration failed:");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
