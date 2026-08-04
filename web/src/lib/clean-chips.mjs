// Pure JS implementation of cleanChips — no TypeScript types so it can be
// imported directly by both explore.ts (which re-exports it) and by
// test-clean-chips.mjs (which can't import .ts without a runner).
// This is the single source of truth for the chip-cleaning logic.

// Guard against a runaway paste/patch, NOT a curation limit. It was 16, which
// silently truncated real seeded config: portals.yml ships ~60 title positives
// and ~110 location keywords, so `allow` was cut mid-alphabet (…florida,
// georgia) and `block` lost every entry after the UK section — foreign roles
// leaked in while most US states were dropped. Truncation is invisible in the
// UI, so the cap must sit above any legitimate list.
const CHIP_CAP = 250;

/** Trim, drop empties, de-dupe case-insensitively, cap length. */
export function cleanChips(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const k = item.trim();
    if (!k) continue;
    if (!/[\p{L}\p{N}]/u.test(k)) continue; // drop punctuation-only junk (e.g. a stray "*")
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= CHIP_CAP) break;
  }
  return out;
}