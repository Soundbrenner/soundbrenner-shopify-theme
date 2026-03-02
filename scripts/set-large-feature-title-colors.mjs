#!/usr/bin/env node

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const FEATURE_METAOBJECT_TYPE = process.env.SHOPIFY_METAOBJECT_TYPE || "sbv2_large_photo_video_feature";
const TARGET_PRODUCT_HANDLE = process.env.TARGET_PRODUCT_HANDLE || "spark-practice-companion";
const ROOT_METAFIELD_NAMESPACE = process.env.ROOT_METAFIELD_NAMESPACE || "custom";
const ROOT_METAFIELD_KEY = process.env.ROOT_METAFIELD_KEY || "sbv2_large_photo_video_features";
const FEATURES_FIELD_KEY = process.env.FEATURES_FIELD_KEY || "features";
const COLOR_FIELD_KEY = process.env.COLOR_FIELD_KEY || "title_part_two_color";
const COLOR_FIELD_LABEL = process.env.COLOR_FIELD_LABEL || "Title part 2 color";
const COLOR_SEQUENCE_INPUT = process.env.COLOR_SEQUENCE || "orange,purple,blue";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const SKIP_EXISTING = process.argv.includes("--skip-existing") || process.env.SKIP_EXISTING === "true";

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

const COLOR_TOKEN_MAP = {
  orange: "tangerine-pop-500",
  purple: "grape-jam-500",
  blue: "berry-blue-700",
  "tangerine-pop-500": "tangerine-pop-500",
  "grape-jam-500": "grape-jam-500",
  "berry-blue-700": "berry-blue-700",
  "primary-500": "primary-500",
};

function log(message, extra = "") {
  const now = new Date().toISOString();
  if (extra) {
    console.log(`[${now}] ${message} ${extra}`);
  } else {
    console.log(`[${now}] ${message}`);
  }
}

function normalizeColorToken(value) {
  const normalized = `${value || ""}`.trim().toLowerCase();
  if (!normalized) return "";
  return COLOR_TOKEN_MAP[normalized] || "";
}

function parseColorSequence(input) {
  const rawParts = `${input || ""}`
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (rawParts.length === 0) {
    throw new Error("No color values were provided");
  }

  const normalized = rawParts.map((part) => {
    const token = normalizeColorToken(part);
    if (!token) {
      throw new Error(
        `Unsupported color token "${part}". Supported: orange, purple, blue, primary-500, tangerine-pop-500, grape-jam-500, berry-blue-700`
      );
    }
    return token;
  });

  return normalized;
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

async function getMetaobjectDefinition(accessToken) {
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

  const data = await runShopifyGraphQL(accessToken, query, { type: FEATURE_METAOBJECT_TYPE });
  return data?.metaobjectDefinitionByType || null;
}

async function updateMetaobjectDefinition(accessToken, definitionId, definitionInput) {
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
  const payload = data?.metaobjectDefinitionUpdate;
  const errors = payload?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(`metaobjectDefinitionUpdate userErrors: ${JSON.stringify(errors)}`);
  }
}

async function ensureColorFieldDefinition(accessToken) {
  const definition = await getMetaobjectDefinition(accessToken);
  if (!definition?.id) {
    throw new Error(`Metaobject definition not found for type "${FEATURE_METAOBJECT_TYPE}"`);
  }

  const existingDefs = Array.isArray(definition.fieldDefinitions) ? definition.fieldDefinitions : [];
  const existingKeys = new Set(existingDefs.map((field) => field.key));
  if (existingKeys.has(COLOR_FIELD_KEY)) {
    log("Definition already has title color field", COLOR_FIELD_KEY);
    return;
  }

  log("Definition is missing title color field", COLOR_FIELD_KEY);
  if (DRY_RUN) {
    log("Dry run enabled: skipping definition update");
    return;
  }

  await updateMetaobjectDefinition(accessToken, definition.id, {
    fieldDefinitions: [
      {
        create: {
          key: COLOR_FIELD_KEY,
          name: COLOR_FIELD_LABEL,
          required: false,
          type: "single_line_text_field",
        },
      },
    ],
  });
  log("Definition updated with operation payload");
}

function parseFeatureIdsFromValue(rawValue) {
  const value = `${rawValue || ""}`.trim();
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => typeof entry === "string" && entry.trim() !== "");
    }
  } catch {
    // Fall through to empty list when JSON parse fails.
  }

  return [];
}

async function getSparkFeatureIds(accessToken) {
  const query = `
    query GetProductLargeFeatureRoot($handle: String!, $namespace: String!, $key: String!) {
      productByHandle(handle: $handle) {
        id
        handle
        metafield(namespace: $namespace, key: $key) {
          id
          value
          reference {
            ... on Metaobject {
              id
              handle
              fields {
                key
                value
                references(first: 50) {
                  nodes {
                    ... on Metaobject {
                      id
                      handle
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await runShopifyGraphQL(accessToken, query, {
    handle: TARGET_PRODUCT_HANDLE,
    namespace: ROOT_METAFIELD_NAMESPACE,
    key: ROOT_METAFIELD_KEY,
  });

  const product = data?.productByHandle;
  if (!product?.id) {
    throw new Error(`Product not found for handle "${TARGET_PRODUCT_HANDLE}"`);
  }

  const rootReference = product?.metafield?.reference;
  if (!rootReference?.id) {
    throw new Error(
      `Product "${TARGET_PRODUCT_HANDLE}" is missing ${ROOT_METAFIELD_NAMESPACE}.${ROOT_METAFIELD_KEY} reference`
    );
  }

  const rootFields = Array.isArray(rootReference.fields) ? rootReference.fields : [];
  const featuresField = rootFields.find((field) => field?.key === FEATURES_FIELD_KEY);
  if (!featuresField) {
    throw new Error(`Root metaobject does not contain "${FEATURES_FIELD_KEY}" field`);
  }

  const featureRefs = Array.isArray(featuresField?.references?.nodes) ? featuresField.references.nodes : [];
  const idsFromRefs = featureRefs
    .map((node) => node?.id)
    .filter((id) => typeof id === "string" && id.trim() !== "");

  if (idsFromRefs.length > 0) {
    return idsFromRefs;
  }

  const idsFromValue = parseFeatureIdsFromValue(featuresField.value);
  if (idsFromValue.length > 0) {
    return idsFromValue;
  }

  throw new Error(`No feature references found in "${FEATURES_FIELD_KEY}"`);
}

async function fetchMetaobjectsByIds(accessToken, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const query = `
    query GetNodes($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Metaobject {
          id
          handle
          fields {
            key
            value
          }
        }
      }
    }
  `;

  const data = await runShopifyGraphQL(accessToken, query, { ids });
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  return nodes.filter((node) => node && node.id);
}

function getFieldValue(fields, key) {
  const list = Array.isArray(fields) ? fields : [];
  const match = list.find((field) => field?.key === key);
  return `${match?.value || ""}`.trim();
}

async function updateMetaobjectColor(accessToken, metaobjectId, colorValue) {
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
    metaobject: {
      fields: [
        {
          key: COLOR_FIELD_KEY,
          value: colorValue,
        },
      ],
    },
  });
  const errors = data?.metaobjectUpdate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(`metaobjectUpdate userErrors: ${JSON.stringify(errors)}`);
  }
}

async function main() {
  const colorSequence = parseColorSequence(COLOR_SEQUENCE_INPUT);
  log(
    "Starting large feature title color sync",
    `product=${TARGET_PRODUCT_HANDLE} colors=${colorSequence.join(",")} dry_run=${DRY_RUN}`
  );

  const accessToken = await getShopifyAccessToken();
  await ensureColorFieldDefinition(accessToken);

  const featureIds = await getSparkFeatureIds(accessToken);
  if (featureIds.length === 0) {
    throw new Error(`No features found for product "${TARGET_PRODUCT_HANDLE}"`);
  }

  const detailedFeatures = await fetchMetaobjectsByIds(accessToken, featureIds);
  const featureById = new Map(detailedFeatures.map((feature) => [feature.id, feature]));

  const targetCount = Math.min(featureIds.length, colorSequence.length);
  if (targetCount < colorSequence.length) {
    log(
      "Not enough features to apply all requested colors",
      `features=${featureIds.length} colors=${colorSequence.length}`
    );
  }

  let updated = 0;
  let skippedExisting = 0;
  let skippedNoChange = 0;

  for (let index = 0; index < targetCount; index += 1) {
    const featureId = featureIds[index];
    const desiredColor = colorSequence[index];
    const feature = featureById.get(featureId);
    const currentColor = normalizeColorToken(getFieldValue(feature?.fields, COLOR_FIELD_KEY));
    const featureHandle = feature?.handle || featureId;

    if (SKIP_EXISTING && currentColor) {
      skippedExisting += 1;
      log("Skipped existing color", `${featureHandle} (${currentColor})`);
      continue;
    }

    if (currentColor === desiredColor) {
      skippedNoChange += 1;
      log("No change needed", `${featureHandle} (${desiredColor})`);
      continue;
    }

    if (DRY_RUN) {
      log("Dry run update", `${featureHandle}: ${currentColor || "blank"} -> ${desiredColor}`);
      updated += 1;
      continue;
    }

    await updateMetaobjectColor(accessToken, featureId, desiredColor);
    updated += 1;
    log("Updated feature color", `${featureHandle}: ${desiredColor}`);
  }

  log(
    "Color sync summary",
    `updated=${updated} skipped_existing=${skippedExisting} skipped_no_change=${skippedNoChange}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
