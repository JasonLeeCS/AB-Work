/**
 * WMS Scheduler - HTML/JS Implementation
 * 
 * This is a dark mode glass morphism HTML version of the Excel VBA scheduler.
 * It replicates the functionality of:
 * - getBricksConnection(): Maps brewery codes to Databricks catalog/schema
 * - GetSchedule(): Queries schedule data based on load type and product type filters
 * 
 * VBA Module Mapping:
 * - getBricksConnection() -> BREWERY_CATALOG_MAP + buildQueryParams()
 * - GetSchedule() -> buildQueryParams() + loadData() + applyFilters()
 * 
 * Query Logic:
 * - Load types determine WHERE clause addendums and date field selection
 * - Product types filter by draft percentage (DRAUGHT > 0, PKG ONLY = 0)
 * - Two queries: weekly (futures) and drags (past 2 days, not checked in)
 */

const BREWERIES = [
  "BALDWINSVILLE",
  "COLUMBUS",
  "CARTERSVILLE",
  "FAIRFIELD",
  "FORT COLLINS",
  "HOUSTON",
  "JACKSONVILLE",
  "LOS ANGELES",
  "MERRIMACK",
  "NEWARK",
  "SAINT LOUIS",
  "WILLIAMSBURG",
];

// Brewery to catalog/schema mapping (matching VBA getBricksConnection logic)
const BREWERY_CATALOG_MAP = {
  "BALDWINSVILLE": { catalog: "oracle", schema: "bbap_wms" },
  "COLUMBUS": { catalog: "oracle", schema: "bcop_wms" },
  "CARTERSVILLE": { catalog: "oracle", schema: "bcvp_wms" },
  "FAIRFIELD": { catalog: "oracle", schema: "bfap_wms" },
  "FORT COLLINS": { catalog: "oracle", schema: "bfcp_wms" },
  "HOUSTON": { catalog: "oracle", schema: "bhop_wms" },
  "JACKSONVILLE": { catalog: "oracle", schema: "bjap_wms" },
  "LOS ANGELES": { catalog: "oracle", schema: "blap_wms" },
  "MERRIMACK": { catalog: "oracle", schema: "bmep_wms" },
  "NEWARK": { catalog: "oracle", schema: "bnep_wms" },
  "SAINT LOUIS": { catalog: "oracle", schema: "bslp_wms" },
  "WILLIAMSBURG": { catalog: "oracle", schema: "bwmp_wms" },
};

const DEFAULT_API_BASE_URL =
  (window.schedulerConfig && window.schedulerConfig.apiBaseUrl) || "";

const demoData = {
  weekly: [
    {
      brewery: "NEWARK",
      scac: "JBTU",
      shipNum: "51002345",
      loadTags: ["ALL OUTBOUND", "LIVE", "ASSET-OTR"],
      productType: "PKG ONLY",
      datetime: addHours(new Date(), 6),
    },
    {
      brewery: "NEWARK",
      scac: "SWFT",
      shipNum: "51002348",
      loadTags: ["ALL OUTBOUND", "DEDICATED"],
      productType: "DRAUGHT",
      datetime: addHours(new Date(), 26),
    },
    {
      brewery: "NEWARK",
      scac: "CNW1",
      shipNum: "51012348",
      loadTags: ["ALL OUTBOUND", "RAIL"],
      productType: "ALL",
      datetime: addHours(new Date(), 54),
    },
    {
      brewery: "BALDWINSVILLE",
      scac: "KNIG",
      shipNum: "43098302",
      loadTags: ["ALL OUTBOUND", "UNCOVERED"],
      productType: "PKG ONLY",
      datetime: addHours(new Date(), 12),
    },
    {
      brewery: "BALDWINSVILLE",
      scac: "JBTU",
      shipNum: "43098322",
      loadTags: ["ALL INBOUND", "INBOUND TR"],
      productType: "ALL",
      datetime: addHours(new Date(), 40),
    },
    {
      brewery: "FORT COLLINS",
      scac: "UPRR",
      shipNum: "66012344",
      loadTags: ["ALL OUTBOUND", "RAIL"],
      productType: "ALL",
      datetime: addHours(new Date(), 72),
    },
    {
      brewery: "FORT COLLINS",
      scac: "HLD1",
      shipNum: "66012348",
      loadTags: ["ALL OUTBOUND", "UNCOVERED"],
      productType: "DRAUGHT",
      datetime: addHours(new Date(), 96),
    },
    {
      brewery: "LOS ANGELES",
      scac: "BNSF",
      shipNum: "78045321",
      loadTags: ["ALL OUTBOUND", "RAIL"],
      productType: "ALL",
      datetime: addHours(new Date(), 30),
    },
    {
      brewery: "LOS ANGELES",
      scac: "JBHT",
      shipNum: "78045331",
      loadTags: ["ALL OUTBOUND", "LIVE"],
      productType: "PKG ONLY",
      datetime: addHours(new Date(), 10),
    },
    {
      brewery: "LOS ANGELES",
      scac: "JBHT",
      shipNum: "78045361",
      loadTags: ["ALL INBOUND", "INBOUND BEER"],
      productType: "ALL",
      datetime: addHours(new Date(), 110),
    },
    {
      brewery: "SAINT LOUIS",
      scac: "HLD2",
      shipNum: "88055442",
      loadTags: ["ALL OUTBOUND", "UNCOVERED"],
      productType: "DRAUGHT",
      datetime: addHours(new Date(), 24),
    },
    {
      brewery: "SAINT LOUIS",
      scac: "YFS1",
      shipNum: "88055462",
      loadTags: ["ALL INBOUND", "INBOUND MTRL"],
      productType: "ALL",
      datetime: addHours(new Date(), 84),
    },
  ],
  drags: [
    {
      brewery: "NEWARK",
      scac: "SWFT",
      shipNum: "51002348",
      loadTags: ["ALL OUTBOUND", "DEDICATED"],
      productType: "DRAUGHT",
      datetime: addHours(new Date(), -12),
    },
    {
      brewery: "BALDWINSVILLE",
      scac: "JBTU",
      shipNum: "43098302",
      loadTags: ["ALL OUTBOUND", "LIVE"],
      productType: "PKG ONLY",
      datetime: addHours(new Date(), -4),
    },
    {
      brewery: "FORT COLLINS",
      scac: "UPRR",
      shipNum: "66012344",
      loadTags: ["ALL OUTBOUND", "RAIL"],
      productType: "ALL",
      datetime: addHours(new Date(), -30),
    },
    {
      brewery: "LOS ANGELES",
      scac: "BNSF",
      shipNum: "78045321",
      loadTags: ["ALL OUTBOUND", "RAIL"],
      productType: "ALL",
      datetime: addHours(new Date(), -10),
    },
  ],
};

const form = document.getElementById("filter-form");
const brewerySelect = document.getElementById("brewery");
const loadTypeSelect = document.getElementById("loadType");
const productTypeSelect = document.getElementById("productType");
const rangeInput = document.getElementById("range");
const rangeValue = document.getElementById("range-value");
const weeklyBody = document.getElementById("weekly-body");
const dragBody = document.getElementById("drag-body");
const weeklyEmpty = document.getElementById("weekly-empty");
const dragEmpty = document.getElementById("drag-empty");
const defaultEmptyMessages = {
  weekly: weeklyEmpty.textContent,
  drags: dragEmpty.textContent,
};
const weeklyCount = document.getElementById("weekly-count");
const dragCount = document.getElementById("drag-count");
const exportWeekly = document.getElementById("export-weekly");
const exportDrags = document.getElementById("export-drags");

document.addEventListener("DOMContentLoaded", () => {
  populateBrewerySelect();
  syncRangeValue();
  form.addEventListener("submit", handleSubmit);
  rangeInput.addEventListener("input", syncRangeValue);
  exportWeekly.addEventListener("click", () => exportTable("weekly"));
  exportDrags.addEventListener("click", () => exportTable("drag"));

  // Initial render using defaults and first brewery.
  brewerySelect.value = "NEWARK";
  handleSubmit(new Event("submit"));
});

function populateBrewerySelect() {
  const fragment = document.createDocumentFragment();
  BREWERIES.forEach((brewery) => {
    const option = document.createElement("option");
    option.value = brewery;
    option.textContent = brewery;
    fragment.appendChild(option);
  });
  brewerySelect.appendChild(fragment);
}

async function handleSubmit(event) {
  event.preventDefault();

  const filters = {
    brewery: brewerySelect.value,
    loadType: loadTypeSelect.value,
    productType: productTypeSelect.value,
    futureDays: Number(rangeInput.value),
  };

  setLoading(true);

  try {
    const dataset = await loadData(filters);

    const filteredWeekly = applyFilters(dataset.weekly, filters, {
      mode: "future",
    });
    const filteredDrags = applyFilters(dataset.drags, filters, {
      mode: "drag",
    });

    renderTable(weeklyBody, weeklyEmpty, filteredWeekly, defaultEmptyMessages.weekly);
    renderTable(dragBody, dragEmpty, filteredDrags, defaultEmptyMessages.drags);
    weeklyCount.textContent = filteredWeekly.length;
    dragCount.textContent = filteredDrags.length;
  } catch (error) {
    console.error(error);
    showError(
      "Unable to refresh schedule. Confirm the API gateway is reachable and returning JSON."
    );
  } finally {
    setLoading(false);
  }
}

function applyFilters(records, filters, options = { mode: "future" }) {
  const now = new Date();
  return records.filter((record) => {
    if (filters.brewery && record.brewery !== filters.brewery) {
      return false;
    }

    if (filters.loadType && !record.loadTags.includes(filters.loadType)) {
      return false;
    }

    if (
      filters.productType !== "ALL" &&
      record.productType !== filters.productType &&
      record.productType !== "ALL"
    ) {
      return false;
    }

    if (options.mode === "future") {
      const end = addDays(now, filters.futureDays);
      return record.datetime >= startOfDay(now) && record.datetime <= end;
    }

    if (options.mode === "drag") {
      const start = addDays(now, -2);
      return record.datetime >= start && record.datetime <= now;
    }

    return true;
  });
}

function renderTable(tbody, emptyState, records, fallbackMessage) {
  tbody.innerHTML = "";
  if (!records.length) {
    emptyState.textContent = fallbackMessage;
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  records
    .sort((a, b) => a.datetime - b.datetime)
    .forEach((record) => {
      const loadTypeLabel =
        Array.isArray(record.loadTags) && record.loadTags.length
          ? record.loadTags[record.loadTags.length - 1]
          : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${record.scac}</td>
        <td>${record.shipNum}</td>
        <td>${formatDate(record.datetime)}</td>
        <td>${formatTime(record.datetime)}</td>
        <td>${loadTypeLabel}</td>
        <td>${record.productType}</td>
      `;
      fragment.appendChild(tr);
    });
  tbody.appendChild(fragment);
}

function syncRangeValue() {
  rangeValue.textContent = `${rangeInput.value} days`;
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addHours(date, hours) {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function exportTable(type) {
  const records = type === "weekly" ? Array.from(weeklyBody.rows) : Array.from(dragBody.rows);
  if (!records.length) {
    return;
  }

  const headers = ["SCAC", "Shipment", "Date", "Time", "Load Type", "Product"];
  const rows = records.map((row) =>
    Array.from(row.cells)
      .map((cell) => `"${cell.textContent.trim()}"`)
      .join(",")
  );

  const csvContent = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = type === "weekly" ? "weekly-loads.csv" : "drag-activity.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Builds query parameters matching VBA GetSchedule logic
 * 
 * This function replicates the VBA Select Case logic for load types:
 * - Maps brewery to catalog/schema (matching getBricksConnection)
 * - Builds whereBlockAddendum based on load type selection
 * - Determines date field type (PULL_TIME/PULL_DATE vs SCHD_HR/SCHD_DATE)
 * - Applies product type filters (DRAUGHT vs PKG ONLY)
 * 
 * The resulting parameters can be sent to a backend API that executes
 * the equivalent SQL queries against Databricks Unity Catalog.
 */
function buildQueryParams(filters) {
  const brewery = filters.brewery.toUpperCase().trim();
  const loadType = filters.loadType;
  const productType = filters.productType;
  
  // Get catalog/schema mapping
  const catalogInfo = BREWERY_CATALOG_MAP[brewery];
  if (!catalogInfo) {
    throw new Error(`Invalid brewery: ${brewery}`);
  }

  // Build where clause addendum based on load type (matching VBA Select Case)
  let whereBlockAddendum = "";
  let dateFieldType = "PULL"; // PULL_TIME/PULL_DATE or SCHD_HR/SCHD_DATE
  
  switch (loadType) {
    case "ALL OUTBOUND":
      whereBlockAddendum = "";
      dateFieldType = "PULL";
      break;
    case "LIVE":
      whereBlockAddendum = "AND (vs.spotting_serv_id = 'LIVE' OR vs.spotting_serv_id IS NULL) AND bc.carr_seq_id IS NOT NULL AND carr.scac_cd <> 'HOLD'";
      dateFieldType = "PULL";
      break;
    case "DEDICATED":
      whereBlockAddendum = "AND bc.ded_flg = 1 AND vs.spotting_serv_id IS NOT NULL AND vs.spotting_serv_id <> 'LIVE'";
      dateFieldType = "PULL";
      break;
    case "ASSET-OTR":
      whereBlockAddendum = "AND vs.spotting_serv_id IS NOT NULL AND vs.spotting_serv_id <> 'LIVE' AND (bc.ded_flg = 0 OR bc.ded_flg IS NULL) AND bc.carr_seq_id IS NOT NULL AND carr.scac_cd <> 'HOLD'";
      dateFieldType = "PULL";
      break;
    case "UNCOVERED":
      whereBlockAddendum = "AND (bc.carr_seq_id IS NULL OR carr.scac_cd = 'HOLD')";
      dateFieldType = "PULL";
      break;
    case "ALL INBOUND":
      whereBlockAddendum = "AND vs.check_in_tsp IS NULL AND vs.inbnd_shpmt_stat_cd = 20";
      dateFieldType = "SCHD";
      break;
    case "RAIL":
      whereBlockAddendum = "AND vs.rail_rte_id IS NOT NULL";
      dateFieldType = "PULL";
      break;
    case "INBOUND TR":
      whereBlockAddendum = "AND vs.check_in_tsp IS NULL AND vs.inbnd_shpmt_stat_cd = 20 AND vs.inbnd_shpmt_typ_cd BETWEEN 2 AND 3";
      dateFieldType = "SCHD";
      break;
    case "INBOUND MTRL":
      whereBlockAddendum = "AND vs.check_in_tsp IS NULL AND vs.inbnd_shpmt_stat_cd = 20 AND vs.inbnd_shpmt_typ_cd = 1";
      dateFieldType = "SCHD";
      break;
    case "INBOUND BEER":
      whereBlockAddendum = "AND vs.check_in_tsp IS NULL AND vs.inbnd_shpmt_stat_cd = 20 AND (vs.inbnd_shpmt_typ_cd = 0 OR vs.inbnd_shpmt_typ_cd = 3 OR vs.inbnd_shpmt_typ_cd = 5)";
      dateFieldType = "SCHD";
      break;
    default:
      throw new Error(`Invalid load type: ${loadType}`);
  }

  // Build draft where addendum based on product type
  let draftWhereAddendum = "";
  if (productType === "DRAUGHT") {
    draftWhereAddendum = "AND vs.dft_pct_qty > 0";
  } else if (productType === "PKG ONLY") {
    draftWhereAddendum = "AND vs.dft_pct_qty = 0";
  }

  return {
    brewery,
    catalog: catalogInfo.catalog,
    schema: catalogInfo.schema,
    loadType,
    productType,
    whereBlockAddendum,
    draftWhereAddendum,
    dateFieldType,
    futureDays: filters.futureDays,
  };
}

async function loadData(filters) {
  if (!DEFAULT_API_BASE_URL) {
    return demoData;
  }

  const queryParams = buildQueryParams(filters);
  
  const params = new URLSearchParams({
    brewery: queryParams.brewery,
    catalog: queryParams.catalog,
    schema: queryParams.schema,
    loadType: queryParams.loadType,
    productType: queryParams.productType,
    whereBlockAddendum: queryParams.whereBlockAddendum,
    draftWhereAddendum: queryParams.draftWhereAddendum,
    dateFieldType: queryParams.dateFieldType,
    futureDays: String(queryParams.futureDays),
  });

  const response = await fetch(`${DEFAULT_API_BASE_URL.replace(/\/$/, "")}/schedule?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Schedule API responded with status ${response.status}`);
  }

  const payload = await response.json();
  const weekly = (payload.weekly || []).map(normalizeRecord);
  const drags = (payload.drags || []).map(normalizeRecord);
  return { weekly, drags };
}

function normalizeRecord(record) {
  // Handle VBA query result format: SCAC, ShipNum, PULL_TIME/PULL_DATE or SCHD_HR/SCHD_DATE
  const datetimeCandidate = record.datetime
    ? new Date(record.datetime)
    : deriveDate(record);
  const datetime = Number.isNaN(datetimeCandidate?.getTime())
    ? new Date()
    : datetimeCandidate;

  return {
    brewery: record.brewery || record.breweryCode || record.brwy || "",
    scac: record.SCAC || record.scac || record.carr_scac || "—",
    shipNum:
      record.ShipNum ||
      record.shipNum ||
      record.shipment ||
      record.pri_xref_shpmt_id ||
      record.shipmentId ||
      record.shipment_id ||
      "—",
    // VBA returns PULL_TIME/PULL_DATE or SCHD_HR/SCHD_DATE
    pullTime: record.PULL_TIME || record.pullTime || null,
    pullDate: record.PULL_DATE || record.pullDate || null,
    schdHr: record.SCHD_HR || record.schdHr || null,
    schdDate: record.SCHD_DATE || record.schdDate || null,
    loadTags: Array.isArray(record.loadTags)
      ? record.loadTags
      : filterTruthy([
          record.loadType,
          record.load_type,
          record.spottingService,
          record.spotting_serv_id,
          record.assignment,
        ]),
    productType:
      record.productType ||
      record.product ||
      record.product_type ||
      "ALL",
    datetime,
  };
}

function deriveDate(record) {
  // Try VBA query result format first (PULL_DATE + PULL_TIME or SCHD_DATE + SCHD_HR)
  if (record.pullDate && record.pullTime) {
    const combined = `${record.pullDate} ${record.pullTime}`;
    const parsed = new Date(combined);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (record.PULL_DATE && record.PULL_TIME) {
    const combined = `${record.PULL_DATE} ${record.PULL_TIME}`;
    const parsed = new Date(combined);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (record.schdDate && record.schdHr) {
    const combined = `${record.schdDate} ${record.schdHr}`;
    const parsed = new Date(combined);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (record.SCHD_DATE && record.SCHD_HR) {
    const combined = `${record.SCHD_DATE} ${record.SCHD_HR}`;
    const parsed = new Date(combined);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // Fallback to timestamp fields
  if (record.pullTimestamp) {
    return new Date(record.pullTimestamp);
  }

  if (record.pull_tsp) {
    return new Date(record.pull_tsp);
  }

  if (record.scheduledUnload) {
    return new Date(record.scheduledUnload);
  }

  if (record.schd_unload_tsp) {
    return new Date(record.schd_unload_tsp);
  }

  return new Date();
}

function filterTruthy(values) {
  return values.filter(Boolean);
}

function setLoading(isLoading) {
  form.classList.toggle("is-loading", isLoading);
  form.querySelectorAll("button, select, input").forEach((el) => {
    el.disabled = isLoading;
  });
}

function showError(message) {
  weeklyBody.innerHTML = "";
  dragBody.innerHTML = "";
  weeklyEmpty.hidden = false;
  dragEmpty.hidden = false;
  weeklyEmpty.textContent = message;
  dragEmpty.textContent = message;
  weeklyCount.textContent = "0";
  dragCount.textContent = "0";
}