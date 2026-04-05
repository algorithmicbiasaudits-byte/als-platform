# ALS Consulting — Bias Audit Platform

**AI Governance & HR Compliance · alsconsulting.netlify.app**
*Built by Aisha Stargill, Founder, ALS Consulting*

---

## What This Is

A two-tier algorithmic bias assessment platform. The self-assessment tool (this repository) allows employers to run an internal review of their AI hiring tools against six active jurisdictions. It is not legally sufficient as an independent audit — it is a conversion funnel that identifies exposure and routes high-risk clients to the ALS Consulting auditor tier.

---

## Repository Structure

```
als-platform/
├── netlify.toml                          # Netlify deploy config
├── README.md
├── netlify/
│   └── functions/
│       └── analyze.js                    # Analysis engine (serverless function)
└── public/
    ├── index.html                        # Landing page
    ├── assets/
    │   ├── styles.css                    # Complete platform stylesheet
    │   └── csv-parser.js                 # ATS file parser (browser)
    ├── screens/
    │   ├── screen-1.html                 # Entry & jurisdiction selection
    │   ├── screen-2.html                 # Data upload
    │   ├── screen-3.html                 # Data validation
    │   ├── screen-5.html                 # Risk score dashboard
    │   ├── screen-6.html                 # Legal sufficiency wall & CTA
    │   ├── screen-7.html                 # Preliminary recommendations
    │   └── screen-8.html                 # Summary export (PDF)
    └── templates/
        └── als-data-template.csv         # Client data template download
```

---

## Jurisdiction Coverage

| Jurisdiction | Lane | Status | Notes |
|---|---|---|---|
| NYC Local Law 144 | Calculation | Active | Enforced since July 2023 |
| Colorado SB 205 | Calculation | **Effective June 30, 2026** | Engine auto-flips on this date |
| Illinois AIVIA | Calculation | Active | Video + text AI assessments |
| California CPRA + AB 2930 | Calculation | Active | Monitor — legal challenges |
| EU AI Act | Calculation | Active | High-risk classification |
| Texas TRAIGA | Documentation | Active | Intent-based — no disparate impact calc |

---

## How the Engine Works

The analysis engine (`netlify/functions/analyze.js`) runs as a Netlify serverless function.

**Input:** POST request with applicant data, selected jurisdictions, and output type (pass/fail or scored).

**Calculations:**
1. Selection rate per protected class group (or scoring rate for scored AEDTs)
2. Impact ratio vs. highest-rate group (four-fifths rule)
3. Intersectional combinations (required by NYC LL144)
4. Groups below 2% of dataset excluded per NYC LL144

**Threshold:** Impact ratio below 0.80 = adverse impact indicated. Binary. No intermediate bands.

**Output:** Risk score (HIGH/LOW), per-group ratios, jurisdiction flags, Colorado countdown, legal sufficiency wall text, Calendly CTA.

---

## Colorado Date Logic

Colorado SB205 effective date is hardcoded in the jurisdiction registry:

```javascript
effectiveDate: new Date("2026-06-30")
```

The engine checks `assessmentDate >= effectiveDate` at runtime using the server date. Before June 30 2026, clients see a countdown and "readiness posture" language. On and after June 30, 2026, enforcement language activates automatically. No manual update required.

---

## Deploying to Netlify

1. Push this repository to GitHub
2. Connect GitHub repo to Netlify
3. Set publish directory: `public`
4. Set functions directory: `netlify/functions`
5. Deploy

The `netlify.toml` handles all routing automatically.

---

## Pricing (Auditor Tier)

| Package | Target | Price |
|---|---|---|
| Essentials Audit | 100–499 employees, 1 jurisdiction | $3,200 |
| Compliance Audit | 500–2,500 employees, up to 2 jurisdictions | $5,800 |
| Enterprise Audit | 2,500+ or 3+ jurisdictions | Custom / $9,500+ |
| Additional AI system | Any tier | +$1,500 |
| Additional jurisdiction | Any tier | +$600 |
| Annual retainer | Ongoing clients | $6,000–$12,000 |

---

## Maintenance

Update `JURISDICTIONS` registry in `netlify/functions/analyze.js` when:
- Jurisdiction effective dates change
- New enforcement guidance is issued
- Federal preemption risk resolves (Texas TRAIGA)
- California legal challenge resolves

Update version log in `ALS_Consulting_Analysis_Engine_Logic_v3.docx` for each change.

---

## Contact

**Aisha Stargill** · Founder, ALS Consulting
calendly.com/astargill-ih3e/30min · alsconsulting.netlify.app · Winston-Salem, NC
