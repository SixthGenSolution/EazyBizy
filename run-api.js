import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { resolve } from "path";

const mode   = process.argv[2] || "";
const host   = mode.includes("lan") ? "0.0.0.0" : process.env.API_HOST || "127.0.0.1";
const port   = mode.includes("lan") ? "8000" : process.env.API_PORT || "8000";
const reload = mode.includes("reload");

const isWin = process.platform === "win32";

// On Windows: only .exe files work with spawnSync (no shell needed, no path issues)
// On Unix:    bin/python works fine
const pythonCandidates = isWin
  ? [
      resolve("backend", ".venv", "Scripts", "python.exe"),
      resolve("backend", ".venv", "Scripts", "python3.exe"),
      resolve(".venv",   "Scripts", "python.exe"),
      "python",
      "python3",
    ]
  : [
      resolve("backend", ".venv_oct", "bin", "python3"),
      resolve("backend", ".venv", "bin", "python"),
      resolve(".venv",   "bin",   "python3"),
      resolve(".venv",   "bin",   "python"),
      "python3",
      "python",
    ];

const python = pythonCandidates.find(
  (c) => c === "python" || c === "python3" || existsSync(c)
);

if (!python) {
  console.error(
    "Cannot find Python. Run:\n" +
    "  cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt"
  );
  process.exit(1);
}

const args = ["-m", "uvicorn", "main:app", "--host", host, "--port", port];
if (reload) args.push("--reload");

console.log(`Starting API: ${python}`);

const result = spawnSync(python, args, { cwd: "backend", stdio: "inherit" });

if (result.error) {
  console.error("Failed to start API server:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
