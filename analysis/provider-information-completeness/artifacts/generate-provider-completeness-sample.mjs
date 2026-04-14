import fs from "node:fs";
import path from "node:path";

const baseUrl = "https://api.sinenvolturas.com/api-web/vendor";
const outputPath = path.resolve(
  "analysis/provider-information-completeness/artifacts/provider-completeness-sample.json",
);
const selectedCategoryIds = new Set([2, 4, 5, 7, 9, 16]);
const samplePerCategory = 8;

function parseEventTypes(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry?.name === "string" ? entry.name : null))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((entry) => typeof entry === "string")
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function pickLocalized(translations, key) {
  if (!Array.isArray(translations)) {
    return null;
  }

  const localized = translations.find((translation) =>
    translation?.language?.locale?.toLowerCase?.().startsWith("es"),
  );
  const candidate = localized ?? translations[0];
  return typeof candidate?.[key] === "string" ? candidate[key] : null;
}

function normalizeSummary(provider) {
  const city =
    typeof provider.city === "string" ? provider.city : provider.city?.name ?? null;
  const country =
    typeof provider.country === "string"
      ? provider.country
      : provider.country?.name ?? null;
  const location = [city, country].filter(Boolean).join(", ") || null;
  const websiteUrl = Array.isArray(provider.social_networks)
    ? (provider.social_networks.find(
        (network) =>
          network?.social_network?.name?.toLowerCase?.() === "web",
      )?.url?.trim() ?? null)
    : null;

  return {
    id: provider.id,
    title: pickLocalized(provider.translations, "title") ?? `Proveedor ${provider.id}`,
    slug: provider.slug ?? null,
    category: pickLocalized(provider.category?.translations, "name"),
    location,
    priceLevel: provider.price_level ?? null,
    rating: provider.rating ?? null,
    detailUrl: provider.slug
      ? `https://sinenvolturas.com/proveedores/${provider.slug}`
      : null,
    websiteUrl,
    minPrice: provider.min_price ?? null,
    maxPrice: provider.max_price ?? null,
    promoBadge: null,
    promoSummary: null,
    descriptionSnippet: null,
    serviceHighlights: [],
    termsHighlights: [],
  };
}

function htmlToLines(html) {
  if (typeof html !== "string" || html.length === 0) {
    return [];
  }

  const withBreaks = html
    .replace(/<\/(p|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, " ");

  return withBreaks
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&Ntilde;/g, "Ñ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => line.replace(/^-+\s*/, ""));
}

function extractLinesAfterHeading(lines, headings, limit) {
  const normalizedHeadings = headings.map((heading) => heading.toLowerCase());
  const startIndex = lines.findIndex((line) =>
    normalizedHeadings.includes(line.toLowerCase().replace(/:$/, "")),
  );

  if (startIndex < 0) {
    return [];
  }

  return lines
    .slice(startIndex + 1)
    .filter(
      (line) =>
        !normalizedHeadings.includes(line.toLowerCase().replace(/:$/, "")),
    )
    .slice(0, limit);
}

function extractInfoSections(translations) {
  if (!Array.isArray(translations) || translations.length === 0) {
    return {
      description: null,
      serviceHighlights: [],
      termsHighlights: [],
    };
  }

  const localized = translations.filter((translation) =>
    translation?.language?.locale?.toLowerCase?.().startsWith("es"),
  );
  const source = localized.length > 0 ? localized : translations;

  let description = null;
  let serviceHighlights = [];
  let termsHighlights = [];

  for (const translation of source) {
    const title = translation?.title?.toLowerCase?.() ?? "";
    const lines = htmlToLines(translation?.description ?? null);

    if (lines.length === 0) {
      continue;
    }

    if (!description && (title.includes("acerca") || title.includes("about"))) {
      description = lines.join(" ");
      continue;
    }

    if (serviceHighlights.length === 0 && title.includes("servicios")) {
      serviceHighlights = lines.slice(0, 3);
      continue;
    }

    if (termsHighlights.length === 0 && title.includes("términos")) {
      termsHighlights = lines.slice(0, 2);
    }
  }

  if (serviceHighlights.length === 0 || termsHighlights.length === 0) {
    const combinedLines = source.flatMap((translation) =>
      htmlToLines(translation?.description ?? null),
    );

    if (serviceHighlights.length === 0) {
      serviceHighlights = extractLinesAfterHeading(
        combinedLines,
        ["servicios que ofrece", "services offered"],
        3,
      );
    }

    if (termsHighlights.length === 0) {
      termsHighlights = extractLinesAfterHeading(
        combinedLines,
        [
          "términos y condiciones",
          "términos  y condiciones",
          "terms and conditions",
        ],
        2,
      );
    }
  }

  if (!description) {
    description = htmlToLines(source[0]?.description ?? null).join(" ").trim() || null;
  }

  return {
    description,
    serviceHighlights,
    termsHighlights,
  };
}

function extractPromo(promos) {
  if (!Array.isArray(promos) || promos.length === 0) {
    return {
      badge: null,
      summary: null,
    };
  }

  for (const promo of promos) {
    const localized = Array.isArray(promo.translations)
      ? promo.translations.filter((translation) =>
          translation?.language?.locale?.toLowerCase?.().startsWith("es"),
        )
      : [];
    const source =
      localized.length > 0
        ? localized
        : Array.isArray(promo.translations)
          ? promo.translations
          : [];
    const translation = source[0];

    if (!translation) {
      continue;
    }

    return {
      badge:
        typeof translation.badge === "string" && translation.badge.trim()
          ? translation.badge.trim()
          : null,
      summary:
        typeof translation.subtitle === "string" && translation.subtitle.trim()
          ? translation.subtitle.trim()
          : null,
    };
  }

  return {
    badge: null,
    summary: null,
  };
}

function firstSentence(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const sentence = normalized.match(/.+?[.!?](\s|$)/)?.[0] ?? normalized;
  return sentence.trim();
}

function enrichDetail(provider) {
  const summary = normalizeSummary(provider);
  const info = extractInfoSections(provider.info_translations ?? null);
  const promo = extractPromo(provider.promos ?? null);

  return {
    ...summary,
    promoBadge: promo.badge,
    promoSummary: promo.summary,
    description:
      info.description ??
      (typeof provider.description === "string" ? provider.description : null),
    descriptionSnippet: firstSentence(
      info.description ??
        (typeof provider.description === "string" ? provider.description : null),
    ),
    serviceHighlights: info.serviceHighlights,
    termsHighlights: info.termsHighlights,
    eventTypes: Array.isArray(provider.event_types)
      ? provider.event_types
          .map((entry) => (typeof entry?.name === "string" ? entry.name : null))
          .filter(Boolean)
      : parseEventTypes(provider.event_types),
  };
}

function hasValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null && value !== undefined && `${value}`.trim() !== "";
}

function fieldStats(records, fields) {
  return Object.fromEntries(
    fields.map((field) => {
      const present = records.filter((record) => hasValue(record[field])).length;
      return [
        field,
        {
          present,
          total: records.length,
          completeness:
            records.length === 0 ? 0 : Number((present / records.length).toFixed(3)),
        },
      ];
    }),
  );
}

function signatureOf(record, fields) {
  return JSON.stringify(
    Object.fromEntries(fields.map((field) => [field, record[field]])),
  );
}

async function fetchJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(`Provider API request failed with ${response.status} for ${pathname}`);
  }
  return await response.json();
}

async function main() {
  const categoriesEnvelope = await fetchJson("/categories");
  const categories = (categoriesEnvelope.data ?? [])
    .filter((category) => selectedCategoryIds.has(category.id))
    .map((category) => ({
      id: category.id,
      slug: category.slug,
      name:
        pickLocalized(category.translations, "name") ??
        category.slug ??
        `category-${category.id}`,
      eventTypes: parseEventTypes(category.event_types),
    }));

  const summaryFields = [
    "slug",
    "category",
    "location",
    "priceLevel",
    "rating",
    "detailUrl",
    "websiteUrl",
    "minPrice",
    "maxPrice",
    "promoBadge",
    "promoSummary",
    "descriptionSnippet",
    "serviceHighlights",
    "termsHighlights",
  ];
  const detailFields = [...summaryFields, "eventTypes"];
  const summaryDifferentiatorFields = [
    "location",
    "priceLevel",
    "rating",
    "websiteUrl",
    "minPrice",
    "maxPrice",
  ];
  const detailDifferentiatorFields = [
    ...summaryDifferentiatorFields,
    "promoBadge",
    "promoSummary",
    "descriptionSnippet",
    "serviceHighlights",
    "termsHighlights",
    "eventTypes",
  ];

  const sampledProviders = [];

  for (const category of categories) {
    const searchEnvelope = await fetchJson(
      `/filtered?search=${encodeURIComponent(category.name)}&page=1`,
    );
    const rawProviders = Array.isArray(searchEnvelope?.data?.data)
      ? searchEnvelope.data.data.slice(0, samplePerCategory)
      : [];

    const summaries = rawProviders.map((provider) => normalizeSummary(provider));
    const details = [];

    for (const provider of rawProviders) {
      const detailEnvelope = await fetchJson(`/${provider.id}`);
      details.push(enrichDetail(detailEnvelope.data));
    }

    sampledProviders.push({
      category,
      searchCount: Array.isArray(searchEnvelope?.data?.data)
        ? searchEnvelope.data.data.length
        : 0,
      sampledCount: rawProviders.length,
      summaries,
      details,
    });
  }

  const allSummaries = sampledProviders.flatMap((entry) =>
    entry.summaries.map((summary) => ({
      ...summary,
      sampledCategory: entry.category.name,
    })),
  );
  const allDetails = sampledProviders.flatMap((entry) =>
    entry.details.map((detail) => ({
      ...detail,
      sampledCategory: entry.category.name,
    })),
  );

  const perCategoryDifferentiation = sampledProviders.map((entry) => {
    const summarySignatures = new Map();
    const detailSignatures = new Map();

    for (const record of entry.summaries) {
      const signature = signatureOf(record, summaryDifferentiatorFields);
      summarySignatures.set(signature, (summarySignatures.get(signature) ?? 0) + 1);
    }

    for (const record of entry.details) {
      const signature = signatureOf(record, detailDifferentiatorFields);
      detailSignatures.set(signature, (detailSignatures.get(signature) ?? 0) + 1);
    }

    const summaryWithAnyDifferentiator = entry.summaries.filter((record) =>
      summaryDifferentiatorFields.some((field) => hasValue(record[field])),
    ).length;
    const detailWithAnyDifferentiator = entry.details.filter((record) =>
      detailDifferentiatorFields.some((field) => hasValue(record[field])),
    ).length;
    const detailWithTwoOrMoreDifferentiators = entry.details.filter(
      (record) =>
        detailDifferentiatorFields.filter((field) => hasValue(record[field]))
          .length >= 2,
    ).length;

    return {
      category: entry.category.name,
      sampledCount: entry.sampledCount,
      summaryUniqueSignatures: summarySignatures.size,
      detailUniqueSignatures: detailSignatures.size,
      summaryCollisionProviders: Array.from(summarySignatures.values())
        .filter((count) => count > 1)
        .reduce((sum, count) => sum + count, 0),
      detailCollisionProviders: Array.from(detailSignatures.values())
        .filter((count) => count > 1)
        .reduce((sum, count) => sum + count, 0),
      summaryWithAnyDifferentiator,
      detailWithAnyDifferentiator,
      detailWithTwoOrMoreDifferentiators,
    };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    samplePerCategory,
    categories,
    aggregate: {
      categoryCount: sampledProviders.length,
      summarySampleCount: allSummaries.length,
      detailSampleCount: allDetails.length,
      summaryFieldCompleteness: fieldStats(allSummaries, summaryFields),
      detailFieldCompleteness: fieldStats(allDetails, detailFields),
      providersWithAnySummaryDifferentiator: allSummaries.filter((record) =>
        summaryDifferentiatorFields.some((field) => hasValue(record[field])),
      ).length,
      providersWithAnyDetailDifferentiator: allDetails.filter((record) =>
        detailDifferentiatorFields.some((field) => hasValue(record[field])),
      ).length,
      providersWithTwoOrMoreDetailDifferentiators: allDetails.filter(
        (record) =>
          detailDifferentiatorFields.filter((field) => hasValue(record[field]))
            .length >= 2,
      ).length,
    },
    perCategoryDifferentiation,
    sampledProviders,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(JSON.stringify(result, null, 2));
}

await main();
