import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_DEPENDENCIES,
  displayName,
  findManifests,
  parseManifest,
  pinDependencies,
  pinTerm,
  resolveDependency,
  type ManifestSet,
} from "../src/context/manifest.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "you-aware-manifest-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const byName = (deps: { name: string }[], name: string) => deps.find((d) => d.name === name);

describe("parseManifest: package.json", () => {
  it("reads dependencies and devDependencies with specifier precision", () => {
    const deps = parseManifest(
      "package.json",
      JSON.stringify({
        name: "app",
        dependencies: {
          react: "^18.2.0",
          next: "15.4.2",
          "date-fns": "~4.1.0",
          "@tanstack/react-query": ">=5.0.0 <6",
          lodash: "*",
          internal: "workspace:*",
          fromgit: "github:user/repo#main",
          zod: "3.x",
          express: "5",
        },
        devDependencies: { vitest: "^2.1.8" },
        peerDependencies: { "react-dom": "^18" },
      }),
    );
    expect(byName(deps, "react")).toMatchObject({ ecosystem: "npm", version: "18.2.0", precision: "major" });
    expect(byName(deps, "next")).toMatchObject({ version: "15.4.2", precision: "exact" });
    expect(byName(deps, "date-fns")).toMatchObject({ version: "4.1.0", precision: "minor" });
    expect(byName(deps, "@tanstack/react-query")).toMatchObject({ version: "5.0.0", precision: "major" });
    expect(byName(deps, "zod")).toMatchObject({ version: "3", precision: "major" });
    expect(byName(deps, "express")).toMatchObject({ version: "5", precision: "major" });
    expect(byName(deps, "vitest")).toMatchObject({ version: "2.1.8", precision: "major" });
    // Unpinnable specifiers are kept as names (so they can still resolve via lockfiles) but carry no version.
    expect(byName(deps, "lodash")).toMatchObject({ name: "lodash" });
    expect(byName(deps, "lodash")!.version).toBeUndefined();
    expect(byName(deps, "internal")!.version).toBeUndefined();
    expect(byName(deps, "fromgit")!.version).toBeUndefined();
    // peerDependencies describe the host, not this project.
    expect(byName(deps, "react-dom")).toBeUndefined();
  });

  it("tolerates malformed JSON", () => {
    expect(parseManifest("package.json", "{ not json")).toEqual([]);
  });
});

describe("parseManifest: Python", () => {
  it("reads PEP 621 dependencies, dependency groups, and Poetry tables from pyproject.toml", () => {
    const deps = parseManifest(
      "pyproject.toml",
      `
[project]
name = "svc"
dependencies = [
  "fastapi[standard]>=0.115.0",
  "pydantic==2.11.4",
  "SQLAlchemy~=2.0.30",
  "httpx",
  "numpy>=1.26; python_version < '3.13'",
]

[dependency-groups]
dev = ["pytest>=8", "ruff==0.6.*"]

[tool.poetry.dependencies]
python = "^3.11"
Django = "^5.1"
celery = { version = "~5.4", extras = ["redis"] }
local-lib = { path = "../lib" }

[tool.poetry.group.dev.dependencies]
mypy = "1.11.2"
`,
    );
    expect(byName(deps, "fastapi")).toMatchObject({ ecosystem: "pypi", version: "0.115.0", precision: "major" });
    expect(byName(deps, "pydantic")).toMatchObject({ version: "2.11.4", precision: "exact" });
    expect(byName(deps, "sqlalchemy")).toMatchObject({ version: "2.0.30", precision: "minor" });
    expect(byName(deps, "httpx")!.version).toBeUndefined();
    expect(byName(deps, "numpy")).toMatchObject({ version: "1.26", precision: "major" });
    expect(byName(deps, "pytest")).toMatchObject({ version: "8", precision: "major" });
    expect(byName(deps, "ruff")).toMatchObject({ version: "0.6", precision: "major" });
    expect(byName(deps, "django")).toMatchObject({ version: "5.1", precision: "major" });
    expect(byName(deps, "celery")).toMatchObject({ version: "5.4", precision: "minor" });
    expect(byName(deps, "local-lib")).toBeUndefined();
    expect(byName(deps, "python")).toBeUndefined();
    expect(byName(deps, "mypy")).toMatchObject({ version: "1.11.2", precision: "exact" });
  });

  it("reads requirements.txt, skipping flags, URLs, comments, and markers", () => {
    const deps = parseManifest(
      "requirements.txt",
      `
# web
fastapi==0.115.0  # pinned
uvicorn[standard]>=0.30,<1
-r base.txt
-e .
git+https://github.com/org/pkg.git@main#egg=pkg
Pillow ; sys_platform == "darwin"
requests @ https://example.com/requests.whl
`,
    );
    expect(deps.map((d) => d.name)).toEqual(["fastapi", "uvicorn", "pillow"]);
    expect(byName(deps, "fastapi")).toMatchObject({ version: "0.115.0", precision: "exact" });
    expect(byName(deps, "uvicorn")).toMatchObject({ version: "0.30", precision: "major" });
  });
});

describe("parseManifest: go.mod and Cargo.toml", () => {
  it("reads direct requires from go.mod, skipping indirect and pseudo-versions", () => {
    const deps = parseManifest(
      "go.mod",
      `
module example.com/svc

go 1.22

require (
	github.com/gin-gonic/gin v1.10.0
	golang.org/x/net v0.28.0 // indirect
	github.com/some/fork v0.0.0-20240101120000-abcdef123456
	gorm.io/gorm v1.25.12
)

require github.com/spf13/cobra v1.8.1
`,
    );
    expect(deps.map((d) => d.name)).toEqual(["github.com/gin-gonic/gin", "gorm.io/gorm", "github.com/spf13/cobra"]);
    expect(byName(deps, "github.com/gin-gonic/gin")).toMatchObject({ ecosystem: "go", version: "1.10.0", precision: "exact" });
  });

  it("reads Cargo.toml dependency tables, inline tables, and sub-tables", () => {
    const deps = parseManifest(
      "Cargo.toml",
      `
[package]
name = "svc"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = { version = "=1.40.0", features = ["full"] }
local = { path = "../local" }
anyhow = "~1.0.80"

[dependencies.reqwest]
version = "0.12"
features = ["json"]

[dev-dependencies]
criterion = "0.5"
`,
    );
    expect(byName(deps, "serde")).toMatchObject({ ecosystem: "cargo", version: "1.0", precision: "major" });
    expect(byName(deps, "tokio")).toMatchObject({ version: "1.40.0", precision: "exact" });
    expect(byName(deps, "anyhow")).toMatchObject({ version: "1.0.80", precision: "minor" });
    expect(byName(deps, "reqwest")).toMatchObject({ version: "0.12", precision: "major" });
    expect(byName(deps, "criterion")).toMatchObject({ version: "0.5", precision: "major" });
    expect(byName(deps, "local")).toBeUndefined();
  });
});

describe("pinTerm", () => {
  it("uses major.minor when the version is known precisely and major only for ranges", () => {
    expect(pinTerm("react", "19.2.1", "installed")).toBe("react 19.2");
    expect(pinTerm("react", "19.2.1", "locked")).toBe("react 19.2");
    expect(pinTerm("next", "15.4.2", "exact")).toBe("next 15.4");
    expect(pinTerm("date-fns", "4.1.0", "minor")).toBe("date-fns 4.1");
    expect(pinTerm("react", "18.2.0", "major")).toBe("react 18");
    expect(pinTerm("express", "5", "major")).toBe("express 5");
  });
  it("keeps the minor for 0.x versions even on ranges (0.x minors are the breaking ones)", () => {
    expect(pinTerm("reqwest", "0.12", "major")).toBe("reqwest 0.12");
    expect(pinTerm("fastapi", "0.115.0", "major")).toBe("fastapi 0.115");
  });
  it("drops prerelease and build metadata", () => {
    expect(pinTerm("vite", "6.0.0-beta.3", "exact")).toBe("vite 6.0");
  });
});

describe("displayName", () => {
  it("uses the bare package for scoped npm names and the last segment for Go modules", () => {
    expect(displayName({ name: "@tanstack/react-query", ecosystem: "npm" })).toBe("react-query");
    expect(displayName({ name: "github.com/labstack/echo/v4", ecosystem: "go" })).toBe("echo");
    expect(displayName({ name: "pydantic", ecosystem: "pypi" })).toBe("pydantic");
  });
});

describe("findManifests", () => {
  it("returns null when no manifest exists anywhere up the tree", () => {
    expect(findManifests(join(root, "a", "b"))).toBeNull();
  });

  it("walks up to the nearest directory with a manifest and reads every manifest there", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }));
    writeFileSync(join(root, "pyproject.toml"), '[project]\ndependencies = ["pydantic==2.11.4"]\n');
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    const set = findManifests(join(root, "src", "deep"))!;
    expect(set.dir).toBe(root);
    expect(set.files).toEqual(["package.json", "pyproject.toml"]);
    expect(set.dependencies.map((d) => `${d.ecosystem}:${d.name}`)).toEqual(["npm:react", "pypi:pydantic"]);
  });

  it("stops at the nearest manifest (a package's own package.json beats the monorepo root)", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    mkdirSync(join(root, "packages", "web"), { recursive: true });
    writeFileSync(join(root, "packages", "web", "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }));
    const set = findManifests(join(root, "packages", "web"))!;
    expect(set.dir).toBe(join(root, "packages", "web"));
    expect(set.dependencies[0]).toMatchObject({ name: "react", version: "19.0.0" });
  });

  it("caps the dependency list", () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < MAX_DEPENDENCIES + 50; i++) deps[`pkg-${i}`] = "1.0.0";
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: deps }));
    expect(findManifests(root)!.dependencies.length).toBe(MAX_DEPENDENCIES);
  });
});

describe("resolveDependency", () => {
  it("prefers the installed node_modules version, then package-lock.json, then the manifest specifier", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0", zod: "^3.23.0", next: "^15.0.0" } }));
    mkdirSync(join(root, "node_modules", "react"), { recursive: true });
    writeFileSync(join(root, "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "19.2.1" }));
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/zod": { version: "3.25.7" } } }),
    );
    const set = findManifests(root)!;
    expect(resolveDependency(set, byName(set.dependencies, "react")!)).toMatchObject({
      version: "19.2.1",
      precision: "installed",
      term: "react 19.2",
    });
    expect(resolveDependency(set, byName(set.dependencies, "zod")!)).toMatchObject({
      version: "3.25.7",
      precision: "locked",
      term: "zod 3.25",
    });
    expect(resolveDependency(set, byName(set.dependencies, "next")!)).toMatchObject({
      version: "15.0.0",
      precision: "major",
      term: "next 15",
    });
  });

  it("resolves scoped npm packages from node_modules and pins them by bare name", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-query": "^5.0.0" } }));
    mkdirSync(join(root, "node_modules", "@tanstack", "react-query"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "@tanstack", "react-query", "package.json"),
      JSON.stringify({ version: "5.62.3" }),
    );
    const set = findManifests(root)!;
    expect(resolveDependency(set, set.dependencies[0]!)).toMatchObject({ precision: "installed", term: "react-query 5.62" });
  });

  it("reads uv.lock / poetry.lock / Cargo.lock [[package]] tables", () => {
    writeFileSync(join(root, "pyproject.toml"), '[project]\ndependencies = ["pydantic>=2"]\n');
    writeFileSync(join(root, "uv.lock"), 'version = 1\n\n[[package]]\nname = "pydantic"\nversion = "2.11.4"\n\n[[package]]\nname = "other"\nversion = "9.9.9"\n');
    writeFileSync(join(root, "Cargo.toml"), '[dependencies]\nserde = "1.0"\n');
    writeFileSync(join(root, "Cargo.lock"), '[[package]]\nname = "serde"\nversion = "1.0.219"\n');
    const set = findManifests(root)!;
    expect(resolveDependency(set, byName(set.dependencies, "pydantic")!)).toMatchObject({ precision: "locked", term: "pydantic 2.11" });
    expect(resolveDependency(set, byName(set.dependencies, "serde")!)).toMatchObject({ precision: "locked", term: "serde 1.0" });
  });

  it("returns null for dependencies with no knowable version", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { lodash: "*" } }));
    const set = findManifests(root)!;
    expect(resolveDependency(set, set.dependencies[0]!)).toBeNull();
  });
});

describe("pinDependencies", () => {
  function setFor(manifest: object, extra?: (dir: string) => void): ManifestSet {
    writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
    extra?.(root);
    return findManifests(root)!;
  }

  it("pins only the dependencies the query names, in query order, at most two", () => {
    const set = setFor({
      dependencies: { react: "18.3.1", next: "15.4.2", zod: "3.25.7", "date-fns": "4.1.0" },
    });
    const pins = pinDependencies("next server actions with zod validation and react forms", set);
    expect(pins.map((p) => p.term)).toEqual(["next 15.4", "zod 3.25"]);
    expect(pinDependencies("best way to parse dates", set)).toEqual([]);
  });

  it("matches common query spellings (nextjs, react-query, tanstack) and scoped names without the @", () => {
    const set = setFor({ dependencies: { next: "15.4.2", "@tanstack/react-query": "5.62.3" } });
    expect(pinDependencies("nextjs middleware redirect", set).map((p) => p.term)).toEqual(["next 15.4"]);
    expect(pinDependencies("tanstack query invalidate cache", set).map((p) => p.term)).toEqual(["react-query 5.62"]);
    expect(pinDependencies("tanstack/react-query mutations", set).map((p) => p.term)).toEqual(["react-query 5.62"]);
  });

  it("matches Go modules by last path segment and Python names across -/_ spellings", () => {
    writeFileSync(join(root, "go.mod"), "module m\n\nrequire github.com/gin-gonic/gin v1.10.0\n");
    writeFileSync(join(root, "requirements.txt"), "scikit-learn==1.5.2\n");
    const set = findManifests(root)!;
    expect(pinDependencies("gin middleware recovery", set).map((p) => p.term)).toEqual(["gin 1.10"]);
    expect(pinDependencies("scikit_learn pipeline grid search", set).map((p) => p.term)).toEqual(["scikit-learn 1.5"]);
    expect(pinDependencies("sklearn pipeline grid search", set).map((p) => p.term)).toEqual(["scikit-learn 1.5"]);
  });

  it("does not pin golang.org/x modules by their generic last segment", () => {
    writeFileSync(join(root, "go.mod"), "module m\n\nrequire golang.org/x/net v0.28.0\n");
    const set = findManifests(root)!;
    expect(pinDependencies("net connection pooling", set)).toEqual([]);
    expect(pinDependencies("golang.org/x/net http2 settings", set).map((p) => p.term)).toEqual(["net 0.28"]);
  });

  it("respects a version the query already carries", () => {
    const set = setFor({ dependencies: { react: "18.3.1" } });
    expect(pinDependencies("react 19 use hook", set)).toEqual([]);
    expect(pinDependencies("react v19 use hook", set)).toEqual([]);
    expect(pinDependencies("react use hook", set).map((p) => p.term)).toEqual(["react 18.3"]);
  });

  it("skips version-change intents (upgrade, migrate, changelog, breaking changes)", () => {
    const set = setFor({ dependencies: { react: "18.3.1" } });
    expect(pinDependencies("react upgrade guide", set)).toEqual([]);
    expect(pinDependencies("migrating react class components", set)).toEqual([]);
    expect(pinDependencies("react changelog", set)).toEqual([]);
    expect(pinDependencies("react breaking changes", set)).toEqual([]);
    expect(pinDependencies("what's new in react", set)).toEqual([]);
  });

  it("uses the installed version when the query names a dependency", () => {
    const set = setFor({ dependencies: { react: "^18.0.0" } }, (dir) => {
      mkdirSync(join(dir, "node_modules", "react"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "react", "package.json"), JSON.stringify({ version: "18.3.1" }));
    });
    expect(pinDependencies("react useEffect cleanup", set)).toMatchObject([
      { name: "react", precision: "installed", term: "react 18.3" },
    ]);
  });

  it("returns nothing for a null manifest set", () => {
    expect(pinDependencies("react hooks", null)).toEqual([]);
  });
});
