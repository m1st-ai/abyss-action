import { appendFileSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

const terminal = new Set(["succeeded", "partial", "failed", "ai_failed"]);

function input(name, { required = false } = {}) {
  const value = process.env[`INPUT_${name.replaceAll("-", "_").toUpperCase()}`]?.trim();
  if (required && !value) throw new Error(`Input '${name}' is required`);
  return value;
}

function booleanInput(name) {
  const value = input(name)?.toLowerCase();
  if (["true", "1", "yes"].includes(value)) return true;
  if (["false", "0", "no"].includes(value)) return false;
  throw new Error(`Input '${name}' must be true or false`);
}

function setOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `${name}=${value}\n`, "utf8");
  else console.log(`::set-output name=${name}::${value}`);
}

async function request(base, key, path, init) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function upload(base, key, file) {
  const info = statSync(file);
  if (!info.isFile()) throw new Error(`Not a file: ${file}`);
  const name = basename(file);
  console.log(`Uploading ${name} (${info.size} bytes)...`);
  const target = await request(base, key, "/v1/uploads", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  const response = await fetch(target.url, {
    method: "PUT",
    body: readFileSync(file),
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  return { name, sizeBytes: info.size, fileCount: 1, s3Key: target.key };
}

async function run() {
  const key = input("api-key", { required: true });
  const base = input("api-url", { required: true }).replace(/\/$/, "");
  const applicationId = input("application-id", { required: true });
  const android = input("android");
  const ios = input("ios");
  const name = input("name") || "GitHub Actions analysis";
  const wait = booleanInput("wait");
  const interval = Number(input("interval"));

  if (!android && !ios) throw new Error("Input 'android' or 'ios' is required");
  if (!Number.isFinite(interval) || interval < 0) throw new Error("Input 'interval' must be a non-negative number");

  const body = { name, applicationId };
  if (android) body.android = await upload(base, key, android);
  if (ios) body.ios = await upload(base, key, ios);

  const created = await request(base, key, "/v1/analyses", {
    method: "POST",
    body: JSON.stringify(body),
  });
  let current = await request(base, key, `/v1/analyses/${created.id}/start`, { method: "POST" });
  setOutput("analysis-id", created.id);
  setOutput("status", current.status);
  console.log(JSON.stringify(current, null, 2));

  if (wait) {
    while (!terminal.has(current.status)) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      current = await request(base, key, `/v1/analyses/${created.id}`);
      setOutput("status", current.status);
      console.log(JSON.stringify(current, null, 2));
    }
  }

  if (["failed", "ai_failed"].includes(current.status)) {
    throw new Error(`Analysis ${created.id} finished with status '${current.status}'`);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
  process.exitCode = 1;
});
