/**
 * ALS Consulting — Bias Audit Platform
 * csv-parser.js
 *
 * Reads the client's ATS export (CSV or Excel-style TSV).
 * Maps raw column headers to the engine's expected field names.
 * Validates required fields before passing data to the engine.
 *
 * Usage (browser):
 *   const result = await parseFile(file);
 *   if (result.error) showError(result.error);
 *   else sendToEngine(result.applicants);
 */

// ── FIELD MAPPING ─────────────────────────────────────────────
// Maps common ATS column names to engine field names.
// Add more aliases here if a client's ATS uses different headers.
const FIELD_MAP = {
  // Applicant ID
  id:             ["id", "applicant id", "applicant_id", "candidate id",
                   "candidate_id", "req id", "application id"],
  // Race / Ethnicity
  race_ethnicity: ["race", "ethnicity", "race/ethnicity", "race_ethnicity",
                   "eeo race", "eeo ethnicity", "race ethnicity",
                   "demographic - race", "race - ethnicity"],
  // Sex / Gender
  sex_gender:     ["sex", "gender", "sex/gender", "sex_gender",
                   "eeo sex", "eeo gender", "gender identity"],
  // Outcome
  outcome:        ["outcome", "disposition", "status", "result",
                   "hired", "selected", "decision", "hire decision",
                   "application status", "candidate status"],
  // Score (for scored-output AEDTs)
  score:          ["score", "total score", "ranking score", "candidate score",
                   "assessment score", "overall score", "rank"],
};

// ── OUTCOME VALUE MAPPING ─────────────────────────────────────
// Maps various "selected" values from ATS exports to "selected"
// and everything else to "not_selected"
const SELECTED_VALUES = [
  "selected", "hired", "yes", "1", "true", "pass", "passed",
  "offer", "offer extended", "offer accepted", "advanced",
  "move forward", "interview", "moved forward", "approved",
];

// ── MAIN PARSE FUNCTION ───────────────────────────────────────
async function parseFile(file) {
  if (!file) return { error: "No file provided." };

  const extension = file.name.split(".").pop().toLowerCase();

  if (extension === "csv") {
    return parseCSV(await file.text());
  }

  if (["xlsx", "xls"].includes(extension)) {
    return parseExcel(file);
  }

  if (extension === "tsv") {
    return parseTSV(await file.text());
  }

  return { error: `Unsupported file type: .${extension}. Please upload a CSV, TSV, or Excel file.` };
}

// ── CSV PARSER ────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { error: "File appears empty or has only one row." };

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.toLowerCase().trim()] = values[idx]?.trim() ?? "";
    });
    rows.push(row);
  }

  return mapFields(headers, rows);
}

// ── TSV PARSER ────────────────────────────────────────────────
function parseTSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { error: "File appears empty or has only one row." };

  const headers = lines[0].split("\t");
  const rows = lines.slice(1).map(line => {
    const values = line.split("\t");
    const row = {};
    headers.forEach((h, idx) => {
      row[h.toLowerCase().trim()] = values[idx]?.trim() ?? "";
    });
    return row;
  });

  return mapFields(headers, rows);
}

// ── EXCEL PARSER ──────────────────────────────────────────────
// Uses SheetJS if available, falls back to error message
async function parseExcel(file) {
  if (typeof XLSX === "undefined") {
    return {
      error: "Excel parsing requires the SheetJS library. " +
             "Please convert your file to CSV and re-upload, " +
             "or ensure SheetJS is loaded on the page."
    };
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      raw: false,
      defval: "",
    });

    if (rows.length === 0) return { error: "Excel file appears empty." };

    const headers = Object.keys(rows[0]);
    const normalizedRows = rows.map(row => {
      const normalized = {};
      Object.entries(row).forEach(([k, v]) => {
        normalized[k.toLowerCase().trim()] = String(v).trim();
      });
      return normalized;
    });

    return mapFields(headers, normalizedRows);
  } catch (err) {
    return { error: `Could not read Excel file: ${err.message}` };
  }
}

// ── CSV LINE PARSER (handles quoted fields) ───────────────────
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ── FIELD MAPPER ──────────────────────────────────────────────
function mapFields(rawHeaders, rows) {
  const headerMap = {};
  const normalizedHeaders = rawHeaders.map(h => h.toLowerCase().trim());

  // Find which raw column maps to which engine field
  for (const [engineField, aliases] of Object.entries(FIELD_MAP)) {
    for (const alias of aliases) {
      const idx = normalizedHeaders.indexOf(alias);
      if (idx !== -1) {
        headerMap[engineField] = normalizedHeaders[idx];
        break;
      }
    }
  }

  // Build validation report
  const found = Object.keys(headerMap);
  const required = ["race_ethnicity", "sex_gender", "outcome"];
  const missing = required.filter(f => !found.includes(f));

  if (missing.length > 0) {
    return {
      error: null,
      warnings: null,
      applicants: null,
      validationErrors: missing.map(f => ({
        field: f,
        message: `Required column not found: "${f.replace("_", " ")}". ` +
                 `Expected one of: ${FIELD_MAP[f].slice(0, 3).join(", ")}`,
      })),
      detectedColumns: normalizedHeaders,
      columnMapping: headerMap,
    };
  }

  // Map and normalize applicant rows
  const applicants = [];
  const warnings = [];

  rows.forEach((row, idx) => {
    const applicant = {
      id: row[headerMap.id] || String(idx + 1),
      race_ethnicity: normalizeRace(row[headerMap.race_ethnicity] || ""),
      sex_gender: normalizeSex(row[headerMap.sex_gender] || ""),
      outcome: normalizeOutcome(row[headerMap.outcome] || ""),
      score: headerMap.score ? parseFloat(row[headerMap.score]) || null : null,
      _raw: row,
    };

    if (!applicant.race_ethnicity) {
      warnings.push(`Row ${idx + 2}: Missing race/ethnicity value.`);
    }
    if (!applicant.sex_gender) {
      warnings.push(`Row ${idx + 2}: Missing sex/gender value.`);
    }

    applicants.push(applicant);
  });

  return {
    error: null,
    validationErrors: [],
    warnings: warnings.slice(0, 20),
    applicants,
    totalRows: rows.length,
    columnMapping: headerMap,
    detectedColumns: normalizedHeaders,
  };
}

// ── NORMALIZERS ───────────────────────────────────────────────
function normalizeOutcome(raw) {
  const val = raw.toLowerCase().trim();
  return SELECTED_VALUES.includes(val) ? "selected" : "not_selected";
}

function normalizeRace(raw) {
  const val = raw.toLowerCase().trim();
  if (!val || val === "unknown" || val === "n/a" || val === "decline") return "";

  // Check "not hispanic" phrases first so pre-normalized EEOC strings don't false-match the hispanic check below
  if (val.includes("not hispanic") || val.includes("not latino")) {
    if (val.includes("black") || val.includes("african")) return "Black or African American (not Hispanic or Latino)";
    if (val.includes("asian")) return "Asian (not Hispanic or Latino)";
    if (val.includes("white") || val.includes("caucasian")) return "White (not Hispanic or Latino)";
    if (val.includes("native hawaiian") || val.includes("pacific")) return "Native Hawaiian or Other Pacific Islander (not Hispanic or Latino)";
    if (val.includes("american indian") || val.includes("alaska")) return "American Indian or Alaska Native (not Hispanic or Latino)";
    if (val.includes("two") || val.includes("multi") || val.includes("biracial")) return "Two or More Races (not Hispanic or Latino)";
  }

  if (val.includes("hispanic") || val.includes("latino")) return "Hispanic or Latino";
  if (val.includes("black") || val.includes("african")) return "Black or African American (not Hispanic or Latino)";
  if (val.includes("asian")) return "Asian (not Hispanic or Latino)";
  if (val.includes("white") || val.includes("caucasian")) return "White (not Hispanic or Latino)";
  if (val.includes("native hawaiian") || val.includes("pacific")) return "Native Hawaiian or Other Pacific Islander (not Hispanic or Latino)";
  if (val.includes("american indian") || val.includes("alaska")) return "American Indian or Alaska Native (not Hispanic or Latino)";
  if (val.includes("two") || val.includes("multi") || val.includes("biracial")) return "Two or More Races (not Hispanic or Latino)";

  // Return as-is if we can not map it — engine will handle unknown categories
  return raw.trim();
}

function normalizeSex(raw) {
  const val = raw.toLowerCase().trim();
  if (!val || val === "unknown" || val === "n/a" || val === "decline") return "";
  if (val === "m" || val === "male" || val === "man") return "Male";
  if (val === "f" || val === "female" || val === "woman") return "Female";
  return "Nonbinary / Not specified";
}

// ── EXPORTS ───────────────────────────────────────────────────
if (typeof module !== "undefined") {
  module.exports = { parseFile, parseCSV, parseTSV, normalizeRace, normalizeSex, normalizeOutcome };
}
