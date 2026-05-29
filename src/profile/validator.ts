import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { Profile } from "./types.js";

// ajv-formats is CJS; its callable lives on `.default` under some interop modes.
type AddFormatsFn = (ajv: Ajv2020) => Ajv2020;
const addFormats: AddFormatsFn =
  (addFormatsImport as unknown as { default?: AddFormatsFn }).default ??
  (addFormatsImport as unknown as AddFormatsFn);

/**
 * Locate spec/profile.schema.json by walking up from this module's directory.
 * This works whether running from src/ (tsx dev) or dist/ (bundled build),
 * since the spec ships alongside the package.
 */
function findSchemaPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "spec", "profile.schema.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate spec/profile.schema.json relative to the package.");
}

let validateFn: ((data: unknown) => boolean) & { errors?: unknown } | null = null;

function getValidator() {
  if (validateFn) return validateFn;
  const schema = JSON.parse(readFileSync(findSchemaPath(), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  validateFn = ajv.compile(schema);
  return validateFn;
}

export class ProfileValidationError extends Error {
  constructor(
    public readonly source: string,
    public readonly issues: string[],
  ) {
    super(`Invalid profile (${source}):\n  - ${issues.join("\n  - ")}`);
    this.name = "ProfileValidationError";
  }
}

/**
 * Validate a parsed object against the profile schema. Throws
 * ProfileValidationError with precise JSON-Pointer paths on failure.
 * Returns the value typed as Profile on success.
 */
export function validateProfile(data: unknown, source = "<unknown>"): Profile {
  const validate = getValidator();
  if (validate(data)) return data as Profile;
  const issues = ((validate.errors as AjvError[] | undefined) ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  throw new ProfileValidationError(source, issues.length ? issues : ["unknown validation error"]);
}

interface AjvError {
  instancePath: string;
  message?: string;
}
