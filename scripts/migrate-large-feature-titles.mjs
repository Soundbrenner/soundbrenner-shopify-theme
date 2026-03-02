#!/usr/bin/env node

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const METAOBJECT_TYPE = process.env.SHOPIFY_METAOBJECT_TYPE || "sbv2_large_photo_video_feature";
const LEGACY_TITLE_KEY = process.env.LEGACY_TITLE_KEY || "title";
const TITLE_ONE_KEY = process.env.TITLE_ONE_KEY || "title_part_one";
const TITLE_TWO_KEY = process.env.TITLE_TWO_KEY || "title_part_two";
const TITLE_ONE_LABEL = process.env.TITLE_ONE_LABEL || "Title part 1";
const TITLE_TWO_LABEL = process.env.TITLE_TWO_LABEL || "Title part 2";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const OVERWRITE_EXISTING =
  process.argv.includes("--overwrite-existing") || process.env.OVERWRITE_EXISTING === "true";

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

function normalizeWhitespace(value) {
  return `${value || ""}`.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  let decoded = `${value || ""}`;
  const named = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
  };

  for (const [entity, replacement] of Object.entries(named)) {
    decoded = decoded.split(entity).join(replacement);
  }

  decoded = decoded.replace(/&#(\d+);/g, (_, code) => {
    const parsed = Number.parseInt(code, 10);
    if (!Number.isFinite(parsed)) return _;
    return String.fromCharCode(parsed);
  });

  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const parsed = Number.parseInt(code, 16);
    if (!Number.isFinite(parsed)) return _;
    return String.fromCharCode(parsed);
  });

  return decoded;
}

function toPlainText(value) {
  let text = `${value || ""}`;
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li)>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  return normalizeWhitespace(text);
}

function splitLegacyTitle(legacyTitleRaw) {
  const source = `${legacyTitleRaw || ""}`;
  if (!source.trim()) {
    return { partOne: "", partTwo: "" };
  }

  const spanMatch = source.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
  if (!spanMatch || typeof spanMatch.index !== "number") {
    return {
      partOne: toPlainText(source),
      partTwo: "",
    };
  }

  const spanStart = spanMatch.index;
  const spanEnd = spanStart + spanMatch[0].length;
  const beforeSpan = source.slice(0, spanStart);
  const afterSpan = source.slice(spanEnd);

  return {
    partOne: toPlainText(`${beforeSpan} ${afterSpan}`),
    partTwo: toPlainText(spanMatch[1]),
  };
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

function normalizeDefinitionForInput(definition) {
  const input = {
    key: definition.key,
    name: definition.name,
    required: Boolean(definition.required),
    type: definition?.type?.name,
  };

  if (definition.description) {
    input.description = definition.description;
  }

  const validations = Array.isArray(definition.validations) ? definition.validations : [];
  if (validations.length > 0) {
    input.validations = validations
      .filter((validation) => validation?.name)
      .map((validation) => ({
        name: validation.name,
        value: validation.value,
      }));
  }

  return input;
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

  const data = await runShopifyGraphQL(accessToken, query, { type: METAOBJECT_TYPE });
  return data?.metaobjectDefinitionByType || null;
}

async function updateMetaobjectDefinition(accessToken, definitionId, definitionInput) {
  const mutation = `
    mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
      metaobjectDefinitionUpdate(id: $id, definition: $definition) {
        metaobjectDefinition {
          id
          fieldDefinitions {
            key
          }
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
  return payload?.metaobjectDefinition;
}

async function ensureTitleFieldDefinitions(accessToken) {
  const definition = await getMetaobjectDefinition(accessToken);
  if (!definition?.id) {
    throw new Error(`Metaobject definition not found for type "${METAOBJECT_TYPE}"`);
  }

  const existingDefs = Array.isArray(definition.fieldDefinitions) ? definition.fieldDefinitions : [];
  const existingKeys = new Set(existingDefs.map((field) => field.key));

  const missingDefs = [];
  if (!existingKeys.has(TITLE_ONE_KEY)) {
    missingDefs.push({
      key: TITLE_ONE_KEY,
      name: TITLE_ONE_LABEL,
      required: false,
      type: "single_line_text_field",
    });
  }
  if (!existingKeys.has(TITLE_TWO_KEY)) {
    missingDefs.push({
      key: TITLE_TWO_KEY,
      name: TITLE_TWO_LABEL,
      required: false,
      type: "single_line_text_field",
    });
  }

  if (missingDefs.length === 0) {
    log("Definition already has title split fields");
    return;
  }

  log(
    "Definition is missing fields",
    missingDefs.map((field) => field.key).join(", ")
  );

  if (DRY_RUN) {
    log("Dry run enabled: skipping definition update");
    return;
  }

  const mergedFieldDefinitions = [
    ...existingDefs.map(normalizeDefinitionForInput),
    ...missingDefs,
  ];

  try {
    await updateMetaobjectDefinition(accessToken, definition.id, {
      fieldDefinitions: mergedFieldDefinitions,
    });
    log("Definition updated with merged fieldDefinitions payload");
    return;
  } catch (error) {
    log("Merged definition update failed, attempting operation payload fallback", error.message);
  }

  await updateMetaobjectDefinition(accessToken, definition.id, {
    fieldDefinitions: missingDefs.map((fieldDefinition) => ({
      create: fieldDefinition,
    })),
  });
  log("Definition updated with operation payload fallback");
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

async function updateMetaobjectTitleFields(accessToken, metaobjectId, fields) {
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
  return data?.metaobjectUpdate?.metaobject;
}

async function runMigration(accessToken) {
  await ensureTitleFieldDefinitions(accessToken);

  const metaobjects = await fetchAllMetaobjects(accessToken);
  if (!metaobjects.length) {
    log(`No entries found for "${METAOBJECT_TYPE}"`);
    return;
  }

  log(`Found ${metaobjects.length} "${METAOBJECT_TYPE}" entries`);

  let updated = 0;
  let skippedExisting = 0;
  let skippedEmpty = 0;
  let skippedNoChange = 0;
  let failed = 0;

  for (const metaobject of metaobjects) {
    const fieldMap = getFieldMap(metaobject);
    const legacyTitle = normalizeWhitespace(fieldMap.get(LEGACY_TITLE_KEY) || "");
    const currentTitleOne = normalizeWhitespace(fieldMap.get(TITLE_ONE_KEY) || "");
    const currentTitleTwo = normalizeWhitespace(fieldMap.get(TITLE_TWO_KEY) || "");

    if (!OVERWRITE_EXISTING && (currentTitleOne || currentTitleTwo)) {
      skippedExisting += 1;
      continue;
    }

    const parsed = splitLegacyTitle(legacyTitle);
    const parsedPartOne = normalizeWhitespace(parsed.partOne);
    const parsedPartTwo = normalizeWhitespace(parsed.partTwo);

    if (!parsedPartOne && !parsedPartTwo) {
      skippedEmpty += 1;
      continue;
    }

    const nextFields = [];

    if (OVERWRITE_EXISTING || !currentTitleOne) {
      nextFields.push({
        key: TITLE_ONE_KEY,
        value: parsedPartOne,
      });
    }

    if (OVERWRITE_EXISTING || !currentTitleTwo) {
      nextFields.push({
        key: TITLE_TWO_KEY,
        value: parsedPartTwo,
      });
    }

    if (nextFields.length === 0) {
      skippedNoChange += 1;
      continue;
    }

    if (DRY_RUN) {
      log(
        "Dry run update",
        `${metaobject.handle}: ${TITLE_ONE_KEY}="${parsedPartOne}" ${TITLE_TWO_KEY}="${parsedPartTwo}"`
      );
      updated += 1;
      continue;
    }

    try {
      await updateMetaobjectTitleFields(accessToken, metaobject.id, nextFields);
      updated += 1;
    } catch (error) {
      failed += 1;
      log("Failed to update metaobject", `${metaobject.handle}: ${error.message}`);
    }
  }

  log(
    "Migration summary",
    `updated=${updated} skipped_existing=${skippedExisting} skipped_empty=${skippedEmpty} skipped_no_change=${skippedNoChange} failed=${failed}`
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  log(
    "Starting large feature title migration",
    `type=${METAOBJECT_TYPE} dry_run=${DRY_RUN} overwrite_existing=${OVERWRITE_EXISTING}`
  );
  const accessToken = await getShopifyAccessToken();
  await runMigration(accessToken);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
