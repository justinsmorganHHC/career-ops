#!/usr/bin/env node
/**
 * demo-sort.mjs
 *
 * Reads a JSON file containing an array of objects, filters them by a
 * field/value pair, and prints the sorted results to stdout as JSON.
 *
 * Usage:
 *   node demo-sort.mjs <file.json> --field <key> --value <val> [--sort <key>] [--reverse]
 *
 * Example data file (people.json):
 *   [
 *     { "name": "Alice", "age": 30, "city": "NYC" },
 *     { "name": "Bob",   "age": 25, "city": "LA"  },
 *     { "name": "Carol", "age": 35, "city": "NYC" }
 *   ]
 *
 * Example commands:
 *   node demo-sort.mjs people.json --field city --value NYC
 *   node demo-sort.mjs people.json --field age --sort age
 *   node demo-sort.mjs people.json --field city --value NYC --sort name --reverse
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Argument parsing (no external deps) ──────────────────────────────
function parseArgs(argv) {
  const args = { file: null, field: null, value: null, sort: null, reverse: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--file":  args.file  = argv[++i]; break;
      case "--field": args.field = argv[++i]; break;
      case "--value": args.value = argv[++i]; break;
      case "--sort":  args.sort  = argv[++i]; break;
      case "--reverse": args.reverse = true;  break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(1);
    }
  }
  return args;
}

// ── Core logic ───────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);

  // Validate required arguments
  if (!args.file) {
    console.error("Error: <file.json> is required.");
    console.log("\nUsage:");
    console.log('  node demo-sort.mjs <file.json> --field <key> --value <val> [--sort <key>] [--reverse]');
    process.exit(1);
  }

  // Read and parse the JSON file
  let data;
  try {
    const raw = readFileSync(resolve(args.file), "utf-8");
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading or parsing "${args.file}": ${err.message}`);
    process.exit(1);
  }

  // Ensure we have an array of objects
  if (!Array.isArray(data)) {
    console.error("Error: JSON root must be an array of objects.");
    process.exit(1);
  }

  // Filter by field/value if specified
  if (args.field) {
    data = data.filter((obj) => String(obj[args.field]) === String(args.value));
  }

  // Sort by field if specified
  if (args.sort) {
    data.sort((a, b) => {
      const va = a[args.sort];
      const vb = b[args.sort];
      // Numeric comparison when both values are numbers
      if (typeof va === "number" && typeof vb === "number") {
        return va - vb;
      }
      // Lexicographic comparison otherwise
      return String(va).localeCompare(String(vb));
    });
  }

  // Reverse if requested
  if (args.reverse) {
    data.reverse();
  }

  // Output results as pretty-printed JSON
  console.log(JSON.stringify(data, null, 2));
}

main();
