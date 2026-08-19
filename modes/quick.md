# Mode: quick — Quick Evaluate (US remote + $200k+ bar)

A fast triage pass for when the candidate wants a yes/no read without spending a full A-G evaluation. Skips Blocks A-G entirely: no CV match table, no comp research, no legitimacy signals, no interview plan. Use this before `oferta`/`auto-pipeline` when the candidate just wants to know "is this even worth a full look."

## Liveness and blacklist gates

Reuse the same gates as `oferta.md` / `auto-pipeline.md` Step 0.5/0.6 (liveness check on URL input, blacklist check against `data/blacklist.md`) before doing anything else. Do not skip these — a dead or blacklisted posting shouldn't get even a quick read.

## Step 1 — Extract the two bar-setting facts

From the JD (text or fetched page), determine:

1. **Location:** is the role US remote (fully remote, US-based, no relocation requirement)? Hybrid, onsite, or non-US roles do not qualify, even if remote-friendly in general terms.
2. **Compensation:** does the JD state a base salary of $200k+ (USD)? Use the low end of a stated range if a range is given (e.g. "$190k-$220k" does not clear the bar; "$200k-$240k" does). Total comp, OTE, equity, or bonus does not count toward this bar — base only, per the same low-reliability-signal discipline `oferta.md` Block D uses for "total package"/"OTE"/"comprehensive salary" language.

If either fact is not stated in the JD, treat it as not met (fail closed — silence is not a pass) but say so explicitly in the paragraph rather than guessing.

## Step 2 — Score

- **Score 5** — both bars are met: US remote AND stated base $200k+.
- **Score 1** — either bar is not met (location wrong, comp unstated, or comp below $200k base). This mode is a binary pass/fail bar, not a graded scale like the full A-G average — so anything short of both conditions gets the same non-passing score. Note in the paragraph *which* bar failed (or both), so the candidate isn't left guessing.

## Step 3 — Write the paragraph

One short paragraph (3-5 sentences), no tables, no headers beyond the report shell below. Cover:
- Role and company, one line on what the job actually is
- The two bar facts found (location + comp, quoted/paraphrased from the JD) and which drove the score
- One sentence of qualitative read if useful (obvious mismatch, notable strength) — optional, skip if it adds nothing beyond the bar check

Do not pull in CV matching, archetype detection, or comp market research — those belong to `oferta`/`auto-pipeline`. If the candidate wants the full picture after seeing this, point them at `/career-ops oferta` or `/career-ops auto-pipeline`.

## Report format

Save to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` using the same atomic numbering as `oferta.md` (`node reserve-report-num.mjs` / `--release`):

```markdown
# Quick Evaluate: {Company} — {Role}

**Date:** {YYYY-MM-DD}
**URL:**
**Score:** {5 or 1}/5
**US Remote:** {yes/no/unstated}
**Base $200k+:** {yes/no/unstated}

{The paragraph from Step 3.}
```

No Machine Summary YAML block — this mode does not feed `salary-gap.mjs`, `risk_summary` aggregation, or other downstream scripts that expect the full A-G schema; it is a standalone triage note.

## Tracker

**Do not write to `data/applications.md` or any tracker-additions TSV.** This mode is explicitly a fast pre-filter meant to run before the candidate commits to a real evaluation — writing a tracker row would create a numbered pipeline entry for a role that was never actually evaluated (no CV match, no comp research, no legitimacy check), which pollutes `data/applications.md` with rows `merge-tracker.mjs` and `stats.mjs` would treat as equivalent to full evaluations. If the candidate wants this role tracked, they run `/career-ops oferta` or `/career-ops auto-pipeline` next, which handles Block-A-G scoring and the tracker write normally — or `/career-ops add` if they just want a bare tracker row without a report.

The report file itself is still saved (so the quick read isn't lost), but it lives outside the tracker until a real evaluation happens.
