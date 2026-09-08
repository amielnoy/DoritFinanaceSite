import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const ENTITIES_DIR = join(REPO_ROOT, "base44/entities");

export interface EntityProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  title?: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

export interface EntitySchema {
  name: string;
  type: "object";
  properties: Record<string, EntityProperty>;
  required?: string[];
  rls?: Record<string, unknown>;
}

/** `.jsonc` here is plain JSON in practice; strip comments defensively anyway. */
const parseJsonc = (raw: string): unknown =>
  JSON.parse(
    raw
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
  );

export function loadEntity(name: string): EntitySchema {
  const raw = readFileSync(join(ENTITIES_DIR, `${name}.jsonc`), "utf8");
  return parseJsonc(raw) as EntitySchema;
}

export function entityNames(): string[] {
  return readdirSync(ENTITIES_DIR)
    .filter((f) => f.endsWith(".jsonc"))
    .map((f) => f.replace(/\.jsonc$/, ""))
    .sort();
}

export interface ValidationIssue {
  field: string;
  problem: string;
}

/**
 * Validates a payload against the subset of JSON Schema the Base44 entity
 * definitions actually use: type, required, enum, minimum/maximum, and
 * (strictly) no undeclared properties.
 */
export function validateAgainstEntity(
  schema: EntitySchema,
  payload: Record<string, unknown>,
  opts: { requireRequired?: boolean } = {}
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const declared = new Set(Object.keys(schema.properties ?? {}));

  for (const key of Object.keys(payload)) {
    if (!declared.has(key)) {
      issues.push({ field: key, problem: "not declared on the entity schema" });
    }
  }

  if (opts.requireRequired !== false) {
    for (const key of schema.required ?? []) {
      if (payload[key] === undefined || payload[key] === null || payload[key] === "") {
        issues.push({ field: key, problem: "required by the entity but missing/empty" });
      }
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    const prop = schema.properties?.[key];
    if (!prop || value === undefined || value === null) continue;

    const actual = Array.isArray(value) ? "array" : typeof value;
    if (prop.type === "number" ? actual !== "number" : actual !== prop.type) {
      issues.push({ field: key, problem: `expected ${prop.type}, got ${actual}` });
      continue;
    }
    if (prop.enum && !prop.enum.includes(value as string)) {
      issues.push({
        field: key,
        problem: `"${String(value)}" is not one of ${prop.enum.join(" | ")}`,
      });
    }
    if (typeof value === "number") {
      if (prop.minimum !== undefined && value < prop.minimum) {
        issues.push({ field: key, problem: `below minimum ${prop.minimum}` });
      }
      if (prop.maximum !== undefined && value > prop.maximum) {
        issues.push({ field: key, problem: `above maximum ${prop.maximum}` });
      }
    }
  }

  return issues;
}
