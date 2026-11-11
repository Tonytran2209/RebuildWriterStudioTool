import { execFile } from "node:child_process";

// Codex treats a piped stdin as additional prompt input and waits for EOF.
// Close it immediately because all worker inputs are passed as arguments.
export function runCommand(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    child.stdin?.end();
  });
}
