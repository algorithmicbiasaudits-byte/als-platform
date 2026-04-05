/**
 * ALS Consulting — Bias Audit Platform
 * Analysis Engine v1.1
 * Author: Aisha Stargill, founder ALS Consulting
 *
 * This module contains all calculation logic for the self-assessment platform.
 * Deploy as a Netlify serverless function at netlify/functions/analyze.js
 *
 * Two-lane architecture:
 *   Calculation lane : NYC LL144, Colorado SB205, Illinois AIVIA,
 *                      California CPRA/AB2930, EU AI Act
 *   Documentation lane: Texas TRAIGA (intent-based, no disparate impact calc)
 */

// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION REGISTRY
// All dates, status flags, and metadata live here.
// Update THIS object when laws change — nothing else needs to touch.
// ─────────────────────────────────────────────────────────────────────────────
const JURISDICTIONS = {
  nyc_ll144: {
    id:           "nyc_ll144",
    name:         "NYC Local Law 144",
    lane:         "calculation",
    effectiveDate: new Date("2023-07-05"),   // already active
    enforced:     true,
    monitor:      false,
    monitorNote:  null,
    requiresIntersectional: true,
    exclusionThreshold: 0.02,               // groups < 2% excluded per LL144
    annualAuditRequired: true,
    publicPostingRequired: true,
  },
  colorado_sb205: {
    id:           "colorado_sb205",
    name:         "Colorado SB 205",
    lane:         "calculation",
    effectiveDate: new Date("2026-06-30"),   // ← auto-flips on this date
    enforced:     false,                     // engine sets this at runtime
    monitor:      false,
    monitorNote:  null,
    requiresIntersectional: false,
    exclusionThreshold: 0.02,
    annualAuditRequired: true,
    publicPostingRequired: false,
    preEnforcementMessage: (daysRemaining) =>
      `Colorado SB205 takes effect June 30, 2026 — ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining. ` +
      `Results reflect your readiness posture, not current legal exposure. ` +
      `Use this assessment to prepare before the enforcement date.`,
    postEnforcementMessage:
      `Colorado SB205 is now fully enforceable. ` +
      `This assessment reflects your current legal exposure. ` +
      `Non-compliance may result in regulatory action.`,
  },
  illinois_aivia: {
    id:           "illinois_aivia",
    name:         "Illinois AI Video Interview Act",
    lane:         "calculation",
    effectiveDate: new Date("2020-01-01"),   // original; 2025 amendment active
    enforced:     true,
    monitor:      false,
    monitorNote:  null,
    requiresIntersectional: false,
    exclusionThreshold: 0.02,
    annualAuditRequired: true,
    publicPostingRequired: false,
    toolScopeNote:
      "AIVIA applies only if the client uses AI to analyze video or text-based interviews. " +
      "Confirm tool scope before flagging this jurisdiction.",
  },
  california_ab2930: {
    id:           "california_ab2930",
    name:         "California CPRA + AB 2930",
    lane:         "calculation",
    effectiveDate: new Date("2026-01-01"),
    enforced:     true,
    monitor:      true,
    monitorNote:
      "California AB 2930 is subject to active legal challenges as of April 2026. " +
      "Confirm current enforcement status with counsel before relying on this assessment " +
      "for California-specific compliance.",
    requiresIntersectional: false,
    exclusionThreshold: 0.02,
    annualAuditRequired: true,
    publicPostingRequired: false,
  },
  eu_ai_act: {
    id:           "eu_ai_act",
    name:         "EU AI Act",
    lane:         "calculation",
    effectiveDate: new Date("2024-08-01"),
    enforced:     true,
    monitor:      false,
    monitorNote:  null,
    requiresIntersectional: false,
    exclusionThreshold: 0.02,
    annualAuditRequired: false,        // lifecycle testing — not just annual
    publicPostingRequired: false,
    broaderScopeNote:
      "EU AI Act scope extends beyond disparate impact into model transparency, " +
      "data governance, and fundamental rights impact assessment. " +
      "Full compliance requires the auditor tier.",
  },
  texas_traiga: {
    id:           "texas_traiga",
    name:         "Texas TRAIGA",
    lane:         "documentation",    // ← NOT calculation lane
    effectiveDate: new Date("2026-01-01"),
    enforced:     true,
    monitor:      true,
    monitorNote:
      "Federal preemption risk: The U.S. House passed a moratorium bill on state AI laws " +
      "in May 2025. Senate outcome pending as of April 2026. Monitor TRAIGA enforceability " +
      "before relying on it for client reporting.",
    intentBased:  true,
    safeHarbor:   "NIST AI Risk Management Framework",
    clientFlag:
      "Texas TRAIGA is intent-based, not impact-based. Your risk score reflects outcome " +
      "data only and does not constitute a TRAIGA compliance determination. Texas compliance " +
      "requires documented AI governance policies and evidence of good-faith compliance " +
      "efforts, including alignment with the NIST AI Risk Management Framework. " +
      "ALS Consulting can assess your documentation posture through a separate " +
      "governance audit engagement.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const FOUR_FIFTHS_THRESHOLD = 0.80;   // the legal standard — do not change

const EEOC_CATEGORIES = [
  "Hispanic or Latino",
  "White (not Hispanic or Latino)",
  "Black or African American (not Hispanic or Latino)",
  "Native Hawaiian or Other Pacific Islander (not Hispanic or Latino)",
  "Asian (not Hispanic or Latino)",
  "American Indian or Alaska Native (not Hispanic or Latino)",
  "Two or More Races (not Hispanic or Latino)",
];

const SEX_CATEGORIES = [
  "Male",
  "Female",
  "Nonbinary / Not specified",   // flagged separately — not required by LL144
];

// ─────────────────────────────────────────────────────────────────────────────
// DATE-AWARE JURISDICTION RESOLVER
// Call this at runtime — it sets enforced status and builds flag messages
// automatically based on today's date. No manual update needed.
// ─────────────────────────────────────────────────────────────────────────────
function resolveJurisdictions(selectedIds, assessmentDate = new Date()) {
  const resolved = {};

  for (const id of selectedIds) {
    const j = JURISDICTIONS[id];
    if (!j) {
      console.warn(`Unknown jurisdiction ID: ${id}`);
      continue;
    }

    // Clone so we don't mutate the registry
    const r = { ...j };

    // Set enforced status based on assessment date
    r.enforced = assessmentDate >= j.effectiveDate;

    // Build Colorado-specific countdown message
    if (id === "colorado_sb205" && !r.enforced) {
      const msRemaining = j.effectiveDate - assessmentDate;
      const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
      r.activeMessage = j.preEnforcementMessage(daysRemaining);
      r.showCountdown = true;
      r.daysRemaining = daysRemaining;
    } else if (id === "colorado_sb205" && r.enforced) {
      r.activeMessage = j.postEnforcementMessage;
      r.showCountdown = false;
      r.daysRemaining = 0;
    }

    resolved[id] = r;
  }

  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE CALCULATION 1 — SELECTION RATE
// ─────────────────────────────────────────────────────────────────────────────
function calcSelectionRate(selected, total) {
  if (total === 0) return null;
  return selected / total;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE CALCULATION 2 — IMPACT RATIO (FOUR-FIFTHS RULE)
// ─────────────────────────────────────────────────────────────────────────────
function calcImpactRatio(groupRate, highestRate) {
  if (highestRate === 0 || highestRate === null) return null;
  return groupRate / highestRate;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE CALCULATION 3 — SCORING RATE (for scored-output AEDTs)
// ─────────────────────────────────────────────────────────────────────────────
function calcScoringRate(applicantsAboveMedian, totalInGroup) {
  if (totalInGroup === 0) return null;
  return applicantsAboveMedian / totalInGroup;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATASET MEDIAN CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────
function calcMedian(scores) {
  if (!scores || scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP PROCESSOR
// Takes raw applicant rows and groups them by protected class category.
// Returns groups with counts, rates, and exclusion flags.
// ─────────────────────────────────────────────────────────────────────────────
function processGroups(applicants, outputType, exclusionThreshold = 0.02) {
  const total = applicants.length;
  if (total === 0) return { error: "No applicants in dataset." };

  // Group by race/ethnicity
  const raceGroups = {};
  const sexGroups  = {};

  for (const row of applicants) {
    const race = row.race_ethnicity?.trim();
    const sex  = row.sex_gender?.trim();

    if (race) {
      if (!raceGroups[race]) raceGroups[race] = { applicants: [] };
      raceGroups[race].applicants.push(row);
    }
    if (sex) {
      if (!sexGroups[sex]) sexGroups[sex] = { applicants: [] };
      sexGroups[sex].applicants.push(row);
    }
  }

  // Calculate rates for each group
  function rateForGroup(group) {
    const groupTotal = group.applicants.length;
    const proportion = groupTotal / total;

    // Apply exclusion rule
    if (proportion < exclusionThreshold) {
      return {
        total: groupTotal,
        proportion: proportion,
        excluded: true,
        exclusionReason: `Group represents ${(proportion * 100).toFixed(1)}% of dataset — below ${(exclusionThreshold * 100)}% threshold. Excluded per NYC LL144 rules.`,
        rate: null,
        impactRatio: null,
        adverseImpact: null,
      };
    }

    let rate = null;

    if (outputType === "pass_fail") {
      const selected = group.applicants.filter(a => a.outcome === "selected").length;
      rate = calcSelectionRate(selected, groupTotal);
    } else if (outputType === "scored") {
      const allScores = applicants.map(a => parseFloat(a.score)).filter(s => !isNaN(s));
      const median    = calcMedian(allScores);
      const aboveMedian = group.applicants.filter(a => parseFloat(a.score) > median).length;
      rate = calcScoringRate(aboveMedian, groupTotal);
    }

    return {
      total: groupTotal,
      proportion: proportion,
      excluded: false,
      rate: rate,
      impactRatio: null,   // filled in after highest rate is known
      adverseImpact: null, // filled in after impact ratio calculated
    };
  }

  // Build group results
  const raceResults = {};
  for (const [name, group] of Object.entries(raceGroups)) {
    raceResults[name] = rateForGroup(group);
  }

  const sexResults = {};
  for (const [name, group] of Object.entries(sexGroups)) {
    sexResults[name] = rateForGroup(group);
  }

  return { raceResults, sexResults, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPACT RATIO APPLIER
// After all rates are calculated, find the highest and apply four-fifths rule.
// ─────────────────────────────────────────────────────────────────────────────
function applyImpactRatios(groupResults) {
  const qualifying = Object.entries(groupResults)
    .filter(([, g]) => !g.excluded && g.rate !== null);

  if (qualifying.length === 0) return groupResults;

  const highestRate = Math.max(...qualifying.map(([, g]) => g.rate));

  for (const [name, group] of Object.entries(groupResults)) {
    if (group.excluded || group.rate === null) continue;
    group.impactRatio    = calcImpactRatio(group.rate, highestRate);
    group.adverseImpact  = group.impactRatio < FOUR_FIFTHS_THRESHOLD;
    group.highestRateGroup = highestRate;
  }

  return groupResults;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERSECTIONAL PROCESSOR
// Required by NYC LL144. Generates race x sex combination groups.
// ─────────────────────────────────────────────────────────────────────────────
function processIntersectional(applicants, outputType, exclusionThreshold = 0.02) {
  const total = applicants.length;
  const intersectGroups = {};

  for (const row of applicants) {
    const race = row.race_ethnicity?.trim();
    const sex  = row.sex_gender?.trim();
    if (!race || !sex) continue;

    const key = `${race} — ${sex}`;
    if (!intersectGroups[key]) intersectGroups[key] = { applicants: [] };
    intersectGroups[key].applicants.push(row);
  }

  const results = {};
  for (const [key, group] of Object.entries(intersectGroups)) {
    const groupTotal  = group.applicants.length;
    const proportion  = groupTotal / total;

    if (proportion < exclusionThreshold) {
      results[key] = {
        total: groupTotal,
        proportion,
        excluded: true,
        exclusionReason: `${(proportion * 100).toFixed(1)}% of dataset — below threshold. Excluded.`,
        rate: null,
        impactRatio: null,
        adverseImpact: null,
      };
      continue;
    }

    let rate = null;
    if (outputType === "pass_fail") {
      const selected = group.applicants.filter(a => a.outcome === "selected").length;
      rate = calcSelectionRate(selected, groupTotal);
    } else if (outputType === "scored") {
      const allScores   = applicants.map(a => parseFloat(a.score)).filter(s => !isNaN(s));
      const median      = calcMedian(allScores);
      const aboveMedian = group.applicants.filter(a => parseFloat(a.score) > median).length;
      rate = calcScoringRate(aboveMedian, groupTotal);
    }

    results[key] = {
      total: groupTotal,
      proportion,
      excluded: false,
      rate,
      impactRatio: null,
      adverseImpact: null,
    };
  }

  return applyImpactRatios(results);
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK SCORE ASSEMBLER
// Binary determination: any adverse impact = HIGH. All clear = LOW.
// ─────────────────────────────────────────────────────────────────────────────
function assembleRiskScore(raceResults, sexResults, intersectionalResults) {
  const allGroups = [
    ...Object.entries(raceResults),
    ...Object.entries(sexResults),
    ...(intersectionalResults ? Object.entries(intersectionalResults) : []),
  ];

  const adverseGroups = allGroups.filter(
    ([, g]) => !g.excluded && g.adverseImpact === true
  );

  const compliantGroups = allGroups.filter(
    ([, g]) => !g.excluded && g.adverseImpact === false
  );

  const excludedGroups = allGroups.filter(([, g]) => g.excluded);

  const riskLevel = adverseGroups.length > 0 ? "HIGH" : "LOW";

  return {
    riskLevel,
    adverseImpact: riskLevel === "HIGH",
    adverseGroups: adverseGroups.map(([name, g]) => ({
      name,
      rate: g.rate,
      impactRatio: g.impactRatio,
      total: g.total,
    })),
    compliantGroups: compliantGroups.map(([name, g]) => ({
      name,
      rate: g.rate,
      impactRatio: g.impactRatio,
      total: g.total,
    })),
    excludedGroups: excludedGroups.map(([name, g]) => ({
      name,
      total: g.total,
      reason: g.exclusionReason,
    })),
    threshold: FOUR_FIFTHS_THRESHOLD,
    determination: riskLevel === "HIGH"
      ? "Adverse impact indicated. One or more protected class groups fall below the four-fifths rule threshold."
      : "No adverse impact indicated. All qualifying groups meet or exceed the four-fifths rule threshold.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION FLAG BUILDER
// Generates the named statute flags for Screen 5.
// ─────────────────────────────────────────────────────────────────────────────
function buildJurisdictionFlags(resolvedJurisdictions, riskScore) {
  const flags = [];

  for (const [id, j] of Object.entries(resolvedJurisdictions)) {

    // Documentation lane — Texas
    if (j.lane === "documentation") {
      flags.push({
        jurisdiction: j.name,
        lane: "documentation",
        enforced: j.enforced,
        message: j.clientFlag,
        monitor: j.monitor,
        monitorNote: j.monitorNote,
        cta: "governance_audit",   // triggers separate CTA
      });
      continue;
    }

    // Calculation lane — build flag from risk score
    const flag = {
      jurisdiction: j.name,
      lane: "calculation",
      enforced: j.enforced,
      riskLevel: j.enforced ? riskScore.riskLevel : "READINESS",
      monitor: j.monitor,
      monitorNote: j.monitorNote || null,
      cta: "bias_audit",
    };

    // Colorado countdown
    if (id === "colorado_sb205") {
      flag.message = j.activeMessage;
      flag.showCountdown = j.showCountdown || false;
      flag.daysRemaining = j.daysRemaining || 0;
    }

    // California monitor warning
    if (id === "california_ab2930" && j.monitor) {
      flag.message = j.monitorNote;
    }

    // EU AI Act broader scope note
    if (id === "eu_ai_act") {
      flag.broaderScopeNote = j.broaderScopeNote;
    }

    // Illinois tool scope check
    if (id === "illinois_aivia") {
      flag.toolScopeNote = j.toolScopeNote;
    }

    flags.push(flag);
  }

  return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGAL SUFFICIENCY WALL
// Always fires on Screen 6 regardless of risk score or jurisdiction.
// ─────────────────────────────────────────────────────────────────────────────
const LEGAL_SUFFICIENCY_WALL = {
  message:
    "This self-assessment is not legally sufficient as an independent bias audit " +
    "under NYC Local Law 144, Colorado SB205, or other applicable regulations. " +
    "To achieve legal compliance, an independent auditor must certify your results.",
  cta: {
    text: "Schedule your free 20-minute compliance review with Aisha Stargill, " +
          "founder of ALS Consulting.",
    link: "https://calendly.com/astargill-ih3e/30min",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE FUNCTION
// This is what Netlify calls. Pass it the client's submitted data.
//
// Input shape:
// {
//   selectedJurisdictions: ["nyc_ll144", "colorado_sb205"],
//   outputType: "pass_fail" | "scored",
//   applicants: [
//     { id, race_ethnicity, sex_gender, outcome, score },
//     ...
//   ],
//   assessmentDate: Date (optional — defaults to today)
// }
//
// Output shape:
// {
//   riskScore, jurisdictionFlags, legalSufficiencyWall,
//   raceResults, sexResults, intersectionalResults, meta
// }
// ─────────────────────────────────────────────────────────────────────────────
function runEngine(input) {
  const {
    selectedJurisdictions = [],
    outputType = "pass_fail",
    applicants = [],
    assessmentDate = new Date(),
  } = input;

  // ── Step 1: Resolve jurisdictions with date-aware status ──
  const resolvedJurisdictions = resolveJurisdictions(selectedJurisdictions, assessmentDate);

  // ── Step 2: Separate calculation vs documentation jurisdictions ──
  const calcJurisdictions = Object.values(resolvedJurisdictions)
    .filter(j => j.lane === "calculation");

  // Use the strictest exclusion threshold across selected jurisdictions
  // (NYC LL144 defines 2% — all others follow)
  const exclusionThreshold = calcJurisdictions.length > 0
    ? Math.min(...calcJurisdictions.map(j => j.exclusionThreshold))
    : 0.02;

  // ── Step 3: Run core group calculations ──
  const { raceResults: rawRace, sexResults: rawSex, total, error } =
    processGroups(applicants, outputType, exclusionThreshold);

  if (error) {
    return { error };
  }

  // ── Step 4: Apply impact ratios ──
  const raceResults = applyImpactRatios(rawRace);
  const sexResults  = applyImpactRatios(rawSex);

  // ── Step 5: Intersectional (required for NYC LL144) ──
  const needsIntersectional = calcJurisdictions.some(j => j.requiresIntersectional);
  const intersectionalResults = needsIntersectional
    ? processIntersectional(applicants, outputType, exclusionThreshold)
    : null;

  // ── Step 6: Assemble risk score ──
  const riskScore = calcJurisdictions.length > 0
    ? assembleRiskScore(raceResults, sexResults, intersectionalResults)
    : { riskLevel: "N/A", adverseImpact: null, determination: "No calculation-lane jurisdictions selected." };

  // ── Step 7: Build jurisdiction flags ──
  const jurisdictionFlags = buildJurisdictionFlags(resolvedJurisdictions, riskScore);

  // ── Step 8: Assemble final output ──
  return {
    riskScore,
    jurisdictionFlags,
    legalSufficiencyWall: LEGAL_SUFFICIENCY_WALL,
    raceResults,
    sexResults,
    intersectionalResults,
    meta: {
      assessmentDate:         assessmentDate.toISOString(),
      totalApplicants:        total,
      outputType,
      selectedJurisdictions,
      threshold:              FOUR_FIFTHS_THRESHOLD,
      exclusionThreshold,
      engineVersion:          "1.1",
      coloradoEffectiveDate:  "2026-06-30",
      coloradoEnforced:       resolvedJurisdictions.colorado_sb205?.enforced ?? null,
      coloradoDaysRemaining:  resolvedJurisdictions.colorado_sb205?.daysRemaining ?? null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NETLIFY SERVERLESS FUNCTION EXPORT
// This is the handler Netlify calls when the client submits their data.
// ─────────────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async function(event) {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const input = JSON.parse(event.body);
    input.assessmentDate = new Date();   // always use server date — not client date
    const result = runEngine(input);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Engine error", detail: err.message }),
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS FOR TESTING
// ─────────────────────────────────────────────────────────────────────────────
// Testing exports — assigned individually to preserve exports.handler above
module.exports.runEngine             = runEngine;
module.exports.resolveJurisdictions  = resolveJurisdictions;
module.exports.calcSelectionRate     = calcSelectionRate;
module.exports.calcImpactRatio       = calcImpactRatio;
module.exports.calcScoringRate       = calcScoringRate;
module.exports.calcMedian            = calcMedian;
module.exports.processGroups         = processGroups;
module.exports.processIntersectional = processIntersectional;
module.exports.applyImpactRatios     = applyImpactRatios;
module.exports.assembleRiskScore     = assembleRiskScore;
module.exports.buildJurisdictionFlags = buildJurisdictionFlags;
module.exports.JURISDICTIONS         = JURISDICTIONS;
module.exports.FOUR_FIFTHS_THRESHOLD = FOUR_FIFTHS_THRESHOLD;
module.exports.LEGAL_SUFFICIENCY_WALL = LEGAL_SUFFICIENCY_WALL;
