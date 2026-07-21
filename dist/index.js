import { appendFileSync, createReadStream, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const OIDC_AUDIENCE = "https://abyss.m1st.ai/github-actions";

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

function networkErrorCode(error) {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) {
    const causeCode = networkErrorCode(error.cause);
    if (causeCode) return causeCode;
  }
  if ("errors" in error && Array.isArray(error.errors)) {
    for (const nested of error.errors) {
      const nestedCode = networkErrorCode(nested);
      if (nestedCode) return nestedCode;
    }
  }
  return undefined;
}

async function fetchWithContext(context, input, init) {
  const retryableCodes = new Set(["EAI_AGAIN", "ECONNRESET", "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(input, init);
    }
    catch (error) {
      const errorCode = networkErrorCode(error);
      const code = errorCode ? ` (${errorCode})` : "";
      if (attempt === 3 || !errorCode || !retryableCodes.has(errorCode)) {
        throw new Error(`${context} failed${code}`);
      }
      console.warn(`${context} failed${code}; retrying (${attempt}/3)...`);
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error(`${context} failed`);
}

async function oidcToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error("GitHub OIDC is unavailable. Add 'permissions: id-token: write' to the workflow.");
  }
  const url = new URL(requestUrl);
  url.searchParams.set("audience", OIDC_AUDIENCE);
  const response = await fetchWithContext("GitHub OIDC token request", url, { headers: { Authorization: `Bearer ${requestToken}` } });
  if (!response.ok) throw new Error(`Could not obtain GitHub OIDC token: ${response.status}`);
  const payload = await response.json();
  if (typeof payload.value !== "string" || !payload.value) throw new Error("GitHub OIDC response did not contain a token");
  return payload.value;
}

async function request(base, path, init) {
  const token = await oidcToken();
  const response = await fetchWithContext("Abyss API request", `${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json();
}

function githubContext() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath ? JSON.parse(readFileSync(eventPath, "utf8")) : {};
  const pullRequest = event.pull_request;
  const pullRequestNumber = Number(pullRequest?.number ?? event.number ?? 0);
  if (!pullRequestNumber) throw new Error("Abyss Action must run for a pull request event");
  return {};
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function upload(base, platform, file, versionName, versionCode) {
  const info = statSync(file);
  if (!info.isFile()) throw new Error(`Not a file: ${file}`);
  const name = basename(file);
  const digest = await sha256(file);
  console.log(`Uploading ${name} (${info.size} bytes)...`);
  const target = await request(base, "/v1/github-actions/artifacts", {
    method: "POST",
    body: JSON.stringify({
      platform,
      versionName: versionName || undefined,
      versionCode: versionCode || undefined,
      name,
      sizeBytes: info.size,
      sha256: digest,
    }),
  });
  if (target.alreadyUploaded) {
    const completed = await request(base, `/v1/github-actions/artifacts/${encodeURIComponent(target.artifactId)}/complete`, { method: "POST" });
    return { name, sizeBytes: info.size, sha256: digest, artifactId: target.artifactId, scanId: completed.scanId, s3Key: "", deduplicated: true };
  }
  const response = await fetchWithContext("Binary upload request", target.upload.url, {
    method: "PUT",
    body: createReadStream(file),
    duplex: "half",
    headers: { "Content-Length": String(info.size) },
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  const completed = await request(base, `/v1/github-actions/artifacts/${encodeURIComponent(target.artifactId)}/complete`, { method: "POST" });
  return { name, sizeBytes: info.size, sha256: digest, artifactId: target.artifactId, scanId: completed.scanId, s3Key: target.upload.key, deduplicated: false };
}

async function run() {
  const base = (input("api-url") || "https://api.abyss.m1st.ai").replace(/\/$/, "");
  const versionName = input("version-name");
  const versionCode = input("version-code");
  const android = input("android");
  const ios = input("ios");

  if (!android && !ios) throw new Error("Input 'android' or 'ios' is required");

  githubContext();
  const androidResult = android ? await upload(base, "ANDROID", android, versionName, versionCode) : undefined;
  const iosResult = ios ? await upload(base, "IOS", ios, versionName, versionCode) : undefined;
  setOutput("android", androidResult ? JSON.stringify(androidResult) : "");
  setOutput("ios", iosResult ? JSON.stringify(iosResult) : "");
  setOutput("android-key", androidResult?.s3Key ?? "");
  setOutput("ios-key", iosResult?.s3Key ?? "");
  setOutput("android-scan-id", androidResult?.scanId ?? "");
  setOutput("ios-scan-id", iosResult?.scanId ?? "");
  console.log("Upload complete.");
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
  process.exitCode = 1;
});
