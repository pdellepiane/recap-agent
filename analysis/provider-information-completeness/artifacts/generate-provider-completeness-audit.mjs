import fs from "node:fs";
import path from "node:path";

const baseUrl = "https://api.sinenvolturas.com/api-web/vendor";
const artifactDir = path.resolve(
  "analysis/provider-information-completeness/artifacts",
);
const auditJsonPath = path.join(artifactDir, "provider-completeness-audit.json");
const providerCsvPath = path.join(artifactDir, "provider-entry-audit.csv");
const categoryCsvPath = path.join(artifactDir, "provider-category-coverage.csv");
const fieldCsvPath = path.join(artifactDir, "provider-field-coverage.csv");
const collisionJsonPath = path.join(artifactDir, "provider-collision-clusters.json");

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

function signatureOf(record, fields) {
  return JSON.stringify(
    Object.fromEntries(fields.map((field) => [field, record[field]])),
  );
}

function csvEscape(value) {
  const stringValue =
    value === null || value === undefined ? "" : String(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes("\"") ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replaceAll("\"", "\"\"")}"`;
  }

  return stringValue;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function round(value) {
  return Number(value.toFixed(3));
}

function looksGenericServiceLine(line) {
  return /preguntar por|consultar|y más|más información/i.test(line);
}

function looksGenericTermsLine(line) {
  return /preguntar por|consultar términos|sujeto a disponibilidad|ubicación\s*:|más información/i.test(
    line,
  );
}

async function fetchJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(`Provider API request failed with ${response.status} for ${pathname}`);
  }

  return await response.json();
}

async function fetchAllSummaries() {
  const pageOne = await fetchJson("/filtered?page=1");
  const total = pageOne?.data?.total ?? 0;
  const lastPage = pageOne?.data?.last_page ?? 1;
  const perPage = pageOne?.data?.per_page ?? 12;
  const records = Array.isArray(pageOne?.data?.data) ? [...pageOne.data.data] : [];

  for (let page = 2; page <= lastPage; page += 1) {
    const envelope = await fetchJson(`/filtered?page=${page}`);
    const pageRecords = Array.isArray(envelope?.data?.data) ? envelope.data.data : [];
    records.push(...pageRecords);
  }

  return {
    total,
    lastPage,
    perPage,
    records,
  };
}

async function main() {
  const categoriesEnvelope = await fetchJson("/categories");
  const categories = (categoriesEnvelope.data ?? []).map((category) => ({
    id: category.id ?? null,
    slug: category.slug ?? null,
    name:
      pickLocalized(category.translations, "name") ??
      category.slug ??
      "Categoría sin nombre",
    eventTypes: parseEventTypes(category.event_types),
  }));
  const categoryEventTypes = new Map(
    categories.map((category) => [category.name, category.eventTypes]),
  );

  const crawl = await fetchAllSummaries();
  const summaryRecords = crawl.records.map((provider) => normalizeSummary(provider));
  const detailRecords = [];

  for (const provider of crawl.records) {
    const detailEnvelope = await fetchJson(`/${provider.id}`);
    detailRecords.push(enrichDetail(detailEnvelope.data));
  }

  const detailById = new Map(detailRecords.map((record) => [record.id, record]));
  const summaryById = new Map(summaryRecords.map((record) => [record.id, record]));

  const providerEntries = detailRecords
    .map((detailRecord) => {
      const summaryRecord = summaryById.get(detailRecord.id);
      const hasLocation = hasValue(detailRecord.location);
      const hasPriceLevel = hasValue(detailRecord.priceLevel);
      const hasMinPrice = hasValue(detailRecord.minPrice);
      const hasMaxPrice = hasValue(detailRecord.maxPrice);
      const hasStructuredPrice = hasPriceLevel || hasMinPrice || hasMaxPrice;
      const hasWebsiteUrl = hasValue(detailRecord.websiteUrl);
      const hasPromoBadge = hasValue(detailRecord.promoBadge);
      const hasPromoSummary = hasValue(detailRecord.promoSummary);
      const hasStructuredPromo = hasPromoBadge || hasPromoSummary;
      const hasDescriptionSnippet = hasValue(detailRecord.descriptionSnippet);
      const hasServiceHighlights = detailRecord.serviceHighlights.length > 0;
      const hasTermsHighlights = detailRecord.termsHighlights.length > 0;
      const hasEventTypes = detailRecord.eventTypes.length > 0;
      const hasNonZeroRating =
        hasValue(detailRecord.rating) && detailRecord.rating !== "0.0";
      const implicitPromoInTitle =
        /%|DSCTO|OFF|GRATIS|REGALO|BONIFICACIÓN|bonificación|descuento|dscto|cortesía/i.test(
          detailRecord.title,
        ) && !hasStructuredPromo;
      const genericServiceHighlights = detailRecord.serviceHighlights.some((line) =>
        looksGenericServiceLine(line),
      );
      const genericTermsHighlights = detailRecord.termsHighlights.some((line) =>
        looksGenericTermsLine(line),
      );
      const comparisonSignalCount = [
        hasLocation,
        hasStructuredPrice,
        hasWebsiteUrl,
        hasStructuredPromo,
        hasDescriptionSnippet,
        hasServiceHighlights,
        hasTermsHighlights,
        hasEventTypes,
        hasNonZeroRating,
      ].filter(Boolean).length;
      const categoryExpectedEventTypes =
        categoryEventTypes.get(detailRecord.category ?? "") ?? [];

      return {
        id: detailRecord.id,
        title: detailRecord.title,
        slug: detailRecord.slug ?? "",
        category: detailRecord.category ?? "(missing)",
        detailUrl: detailRecord.detailUrl ?? "",
        location: detailRecord.location ?? "",
        priceLevel: detailRecord.priceLevel ?? "",
        minPrice: detailRecord.minPrice ?? "",
        maxPrice: detailRecord.maxPrice ?? "",
        rating: detailRecord.rating ?? "",
        websiteUrl: detailRecord.websiteUrl ?? "",
        promoBadge: detailRecord.promoBadge ?? "",
        promoSummary: detailRecord.promoSummary ?? "",
        descriptionSnippet: detailRecord.descriptionSnippet ?? "",
        serviceHighlights: detailRecord.serviceHighlights,
        termsHighlights: detailRecord.termsHighlights,
        eventTypes: detailRecord.eventTypes,
        categoryExpectedEventTypes,
        summaryLocation: summaryRecord?.location ?? "",
        summaryPriceLevel: summaryRecord?.priceLevel ?? "",
        summaryWebsiteUrl: summaryRecord?.websiteUrl ?? "",
        summaryMinPrice: summaryRecord?.minPrice ?? "",
        summaryMaxPrice: summaryRecord?.maxPrice ?? "",
        hasLocation,
        hasPriceLevel,
        hasMinPrice,
        hasMaxPrice,
        hasStructuredPrice,
        hasWebsiteUrl,
        hasPromoBadge,
        hasPromoSummary,
        hasStructuredPromo,
        hasDescriptionSnippet,
        hasServiceHighlights,
        hasTermsHighlights,
        hasEventTypes,
        hasNonZeroRating,
        implicitPromoInTitle,
        genericServiceHighlights,
        genericTermsHighlights,
        comparisonSignalCount,
        issueFlags: [
          !hasLocation ? "missing_location" : null,
          !hasStructuredPrice ? "missing_structured_price" : null,
          !hasStructuredPromo ? "missing_promo_structure" : null,
          !hasServiceHighlights ? "missing_service_highlights" : null,
          !hasTermsHighlights ? "missing_terms_highlights" : null,
          !hasEventTypes ? "missing_event_types" : null,
          !hasNonZeroRating ? "zero_or_missing_rating" : null,
          implicitPromoInTitle ? "implicit_promo_only" : null,
          genericServiceHighlights ? "generic_service_highlights" : null,
          genericTermsHighlights ? "generic_terms_highlights" : null,
        ].filter(Boolean),
      };
    })
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.title.localeCompare(right.title) ||
        left.id - right.id,
    );

  const fieldDefinitions = [
    { field: "location", label: "Location", selector: (entry) => entry.hasLocation },
    {
      field: "priceLevel",
      label: "Price level",
      selector: (entry) => entry.hasPriceLevel,
    },
    { field: "minPrice", label: "Min price", selector: (entry) => entry.hasMinPrice },
    { field: "maxPrice", label: "Max price", selector: (entry) => entry.hasMaxPrice },
    {
      field: "structuredPrice",
      label: "Structured price",
      selector: (entry) => entry.hasStructuredPrice,
    },
    {
      field: "websiteUrl",
      label: "Website URL",
      selector: (entry) => entry.hasWebsiteUrl,
    },
    {
      field: "promoBadge",
      label: "Promo badge",
      selector: (entry) => entry.hasPromoBadge,
    },
    {
      field: "promoSummary",
      label: "Promo summary",
      selector: (entry) => entry.hasPromoSummary,
    },
    {
      field: "structuredPromo",
      label: "Structured promo",
      selector: (entry) => entry.hasStructuredPromo,
    },
    {
      field: "descriptionSnippet",
      label: "Description snippet",
      selector: (entry) => entry.hasDescriptionSnippet,
    },
    {
      field: "serviceHighlights",
      label: "Service highlights",
      selector: (entry) => entry.hasServiceHighlights,
    },
    {
      field: "termsHighlights",
      label: "Terms highlights",
      selector: (entry) => entry.hasTermsHighlights,
    },
    {
      field: "eventTypes",
      label: "Event types",
      selector: (entry) => entry.hasEventTypes,
    },
    {
      field: "nonZeroRating",
      label: "Non-zero rating",
      selector: (entry) => entry.hasNonZeroRating,
    },
  ];

  const fieldCoverage = fieldDefinitions.map((definition) => {
    const present = providerEntries.filter((entry) => definition.selector(entry)).length;
    return {
      field: definition.field,
      label: definition.label,
      present,
      total: providerEntries.length,
      missing: providerEntries.length - present,
      completeness: round(present / providerEntries.length),
    };
  });

  const categoryCoverage = Array.from(
    new Set(providerEntries.map((entry) => entry.category)),
  )
    .map((category) => {
      const entries = providerEntries.filter((entry) => entry.category === category);
      const result = {
        category,
        providerCount: entries.length,
      };

      for (const definition of fieldDefinitions) {
        const present = entries.filter((entry) => definition.selector(entry)).length;
        result[`${definition.field}Present`] = present;
        result[`${definition.field}Completeness`] = round(present / entries.length);
      }

      return result;
    })
    .sort(
      (left, right) =>
        right.providerCount - left.providerCount ||
        left.category.localeCompare(right.category),
    );

  const scoreDistribution = Array.from(
    providerEntries.reduce((distribution, entry) => {
      distribution.set(
        entry.comparisonSignalCount,
        (distribution.get(entry.comparisonSignalCount) ?? 0) + 1,
      );
      return distribution;
    }, new Map()),
  )
    .map(([score, count]) => ({ score, count }))
    .sort((left, right) => left.score - right.score);

  const issueDefinitions = [
    "missing_location",
    "missing_structured_price",
    "missing_promo_structure",
    "missing_service_highlights",
    "missing_terms_highlights",
    "missing_event_types",
    "zero_or_missing_rating",
    "implicit_promo_only",
    "generic_service_highlights",
    "generic_terms_highlights",
  ];

  const issueInventory = Object.fromEntries(
    issueDefinitions.map((issue) => [
      issue,
      providerEntries
        .filter((entry) => entry.issueFlags.includes(issue))
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          category: entry.category,
          detailUrl: entry.detailUrl,
        })),
    ]),
  );

  const summarySignatureFields = [
    "location",
    "priceLevel",
    "rating",
    "websiteUrl",
    "minPrice",
    "maxPrice",
  ];
  const detailSignatureFields = [
    ...summarySignatureFields,
    "promoBadge",
    "promoSummary",
    "descriptionSnippet",
    "serviceHighlights",
    "termsHighlights",
    "eventTypes",
  ];

  function buildClusters(sourceEntries, fields, prefix) {
    const byCategory = new Map();

    for (const entry of sourceEntries) {
      const category = entry.category;
      const signatures = byCategory.get(category) ?? new Map();
      const signature = signatureOf(entry, fields);
      const cluster = signatures.get(signature) ?? [];
      cluster.push({
        id: entry.id,
        title: entry.title,
        detailUrl: entry.detailUrl,
      });
      signatures.set(signature, cluster);
      byCategory.set(category, signatures);
    }

    return Array.from(byCategory.entries())
      .flatMap(([category, signatures]) =>
        Array.from(signatures.entries())
          .filter(([, providers]) => providers.length > 1)
          .map(([signature, providers]) => ({
            clusterType: prefix,
            category,
            providerCount: providers.length,
            signature,
            providers,
          })),
      )
      .sort(
        (left, right) =>
          right.providerCount - left.providerCount ||
          left.category.localeCompare(right.category),
      );
  }

  const summaryEntriesForClusters = providerEntries.map((entry) => ({
    ...entry,
    websiteUrl: entry.summaryWebsiteUrl,
    location: entry.summaryLocation,
    priceLevel: entry.summaryPriceLevel,
    minPrice: entry.summaryMinPrice,
    maxPrice: entry.summaryMaxPrice,
  }));
  const summaryCollisionClusters = buildClusters(
    summaryEntriesForClusters,
    summarySignatureFields,
    "summary",
  );
  const detailCollisionClusters = buildClusters(
    providerEntries,
    detailSignatureFields,
    "detail",
  );

  const providerCsvRows = providerEntries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    slug: entry.slug,
    category: entry.category,
    detailUrl: entry.detailUrl,
    location: entry.location,
    priceLevel: entry.priceLevel,
    minPrice: entry.minPrice,
    maxPrice: entry.maxPrice,
    rating: entry.rating,
    websiteUrl: entry.websiteUrl,
    promoBadge: entry.promoBadge,
    promoSummary: entry.promoSummary,
    descriptionSnippet: entry.descriptionSnippet,
    serviceHighlightsCount: entry.serviceHighlights.length,
    termsHighlightsCount: entry.termsHighlights.length,
    eventTypesCount: entry.eventTypes.length,
    categoryExpectedEventTypes: entry.categoryExpectedEventTypes.join(" | "),
    hasLocation: entry.hasLocation,
    hasStructuredPrice: entry.hasStructuredPrice,
    hasWebsiteUrl: entry.hasWebsiteUrl,
    hasStructuredPromo: entry.hasStructuredPromo,
    hasDescriptionSnippet: entry.hasDescriptionSnippet,
    hasServiceHighlights: entry.hasServiceHighlights,
    hasTermsHighlights: entry.hasTermsHighlights,
    hasEventTypes: entry.hasEventTypes,
    hasNonZeroRating: entry.hasNonZeroRating,
    implicitPromoInTitle: entry.implicitPromoInTitle,
    genericServiceHighlights: entry.genericServiceHighlights,
    genericTermsHighlights: entry.genericTermsHighlights,
    comparisonSignalCount: entry.comparisonSignalCount,
    issueFlags: entry.issueFlags.join(" | "),
  }));

  const categoryCsvRows = categoryCoverage.map((entry) => ({
    category: entry.category,
    providerCount: entry.providerCount,
    locationPresent: entry.locationPresent,
    locationCompleteness: entry.locationCompleteness,
    structuredPricePresent: entry.structuredPricePresent,
    structuredPriceCompleteness: entry.structuredPriceCompleteness,
    websiteUrlPresent: entry.websiteUrlPresent,
    websiteUrlCompleteness: entry.websiteUrlCompleteness,
    structuredPromoPresent: entry.structuredPromoPresent,
    structuredPromoCompleteness: entry.structuredPromoCompleteness,
    descriptionSnippetPresent: entry.descriptionSnippetPresent,
    descriptionSnippetCompleteness: entry.descriptionSnippetCompleteness,
    serviceHighlightsPresent: entry.serviceHighlightsPresent,
    serviceHighlightsCompleteness: entry.serviceHighlightsCompleteness,
    termsHighlightsPresent: entry.termsHighlightsPresent,
    termsHighlightsCompleteness: entry.termsHighlightsCompleteness,
    eventTypesPresent: entry.eventTypesPresent,
    eventTypesCompleteness: entry.eventTypesCompleteness,
    nonZeroRatingPresent: entry.nonZeroRatingPresent,
    nonZeroRatingCompleteness: entry.nonZeroRatingCompleteness,
  }));

  const fieldCsvRows = fieldCoverage.map((entry) => ({
    field: entry.field,
    label: entry.label,
    present: entry.present,
    total: entry.total,
    missing: entry.missing,
    completeness: entry.completeness,
  }));

  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    crawl: {
      totalProvidersReported: crawl.total,
      lastPage: crawl.lastPage,
      perPage: crawl.perPage,
      fetchedSummaries: summaryRecords.length,
      fetchedDetails: detailRecords.length,
      categoriesReported: categories.length,
    },
    categories,
    fieldCoverage,
    categoryCoverage,
    scoreDistribution,
    issueInventory,
    collisionClusters: {
      summary: summaryCollisionClusters,
      detail: detailCollisionClusters,
    },
    providers: providerEntries,
  };

  fs.writeFileSync(auditJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    providerCsvPath,
    toCsv(providerCsvRows, [
      "id",
      "title",
      "slug",
      "category",
      "detailUrl",
      "location",
      "priceLevel",
      "minPrice",
      "maxPrice",
      "rating",
      "websiteUrl",
      "promoBadge",
      "promoSummary",
      "descriptionSnippet",
      "serviceHighlightsCount",
      "termsHighlightsCount",
      "eventTypesCount",
      "categoryExpectedEventTypes",
      "hasLocation",
      "hasStructuredPrice",
      "hasWebsiteUrl",
      "hasStructuredPromo",
      "hasDescriptionSnippet",
      "hasServiceHighlights",
      "hasTermsHighlights",
      "hasEventTypes",
      "hasNonZeroRating",
      "implicitPromoInTitle",
      "genericServiceHighlights",
      "genericTermsHighlights",
      "comparisonSignalCount",
      "issueFlags",
    ]),
    "utf8",
  );
  fs.writeFileSync(
    categoryCsvPath,
    toCsv(categoryCsvRows, [
      "category",
      "providerCount",
      "locationPresent",
      "locationCompleteness",
      "structuredPricePresent",
      "structuredPriceCompleteness",
      "websiteUrlPresent",
      "websiteUrlCompleteness",
      "structuredPromoPresent",
      "structuredPromoCompleteness",
      "descriptionSnippetPresent",
      "descriptionSnippetCompleteness",
      "serviceHighlightsPresent",
      "serviceHighlightsCompleteness",
      "termsHighlightsPresent",
      "termsHighlightsCompleteness",
      "eventTypesPresent",
      "eventTypesCompleteness",
      "nonZeroRatingPresent",
      "nonZeroRatingCompleteness",
    ]),
    "utf8",
  );
  fs.writeFileSync(
    fieldCsvPath,
    toCsv(fieldCsvRows, [
      "field",
      "label",
      "present",
      "total",
      "missing",
      "completeness",
    ]),
    "utf8",
  );
  fs.writeFileSync(
    collisionJsonPath,
    `${JSON.stringify(result.collisionClusters, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: result.generatedAt,
        crawl: result.crawl,
        fieldCoverage: result.fieldCoverage,
        scoreDistribution: result.scoreDistribution,
        detailCollisionClusterCount: detailCollisionClusters.length,
      },
      null,
      2,
    ),
  );
}

await main();
