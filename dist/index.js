import { appendFileSync, createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";

function input(name, { required = false } = {}) {
  const value = process.env[`INPUT_${name.replaceAll("-", "_").toUpperCase()}`]?.trim();
  if (required && !value) throw new Error(`Input '${name}' is required`);
  return value;
}

function setOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const delimiter = `abyss_${randomUUID()}`;
    appendFileSync(output, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
  }
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
    body: createReadStream(file),
    duplex: "half",
    headers: { "Content-Length": String(info.size) },
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  return { name, sizeBytes: info.size, fileCount: 1, s3Key: target.key };
}

async function run() {
  const key = input("api-key", { required: true });
  const base = input("api-url", { required: true }).replace(/\/$/, "");
  const android = input("android");
  const ios = input("ios");

  if (!android && !ios) throw new Error("Input 'android' or 'ios' is required");

  const androidResult = android ? await upload(base, key, android) : undefined;
  const iosResult = ios ? await upload(base, key, ios) : undefined;
  setOutput("android", androidResult ? JSON.stringify(androidResult) : "");
  setOutput("ios", iosResult ? JSON.stringify(iosResult) : "");
  setOutput("android-key", androidResult?.s3Key ?? "");
  setOutput("ios-key", iosResult?.s3Key ?? "");
  console.log("Upload complete.");
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
  process.exitCode = 1;
});
