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

const weeklyLoads = [
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
];

const dragLoads = [
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
];

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

function handleSubmit(event) {
  event.preventDefault();

  const filters = {
    brewery: brewerySelect.value,
    loadType: loadTypeSelect.value,
    productType: productTypeSelect.value,
    futureDays: Number(rangeInput.value),
  };

  const filteredWeekly = applyFilters(weeklyLoads, filters, {
    mode: "future",
  });
  const filteredDrags = applyFilters(dragLoads, filters, {
    mode: "drag",
  });

  renderTable(weeklyBody, weeklyEmpty, filteredWeekly);
  renderTable(dragBody, dragEmpty, filteredDrags);
  weeklyCount.textContent = filteredWeekly.length;
  dragCount.textContent = filteredDrags.length;
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

function renderTable(tbody, emptyState, records) {
  tbody.innerHTML = "";
  if (!records.length) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  records
    .sort((a, b) => a.datetime - b.datetime)
    .forEach((record) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${record.scac}</td>
        <td>${record.shipNum}</td>
        <td>${formatDate(record.datetime)}</td>
        <td>${formatTime(record.datetime)}</td>
        <td>${record.loadTags[record.loadTags.length - 1]}</td>
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
