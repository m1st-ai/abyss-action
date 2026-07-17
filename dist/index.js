import { appendFileSync, createReadStream, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";

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

function githubContext() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath ? JSON.parse(readFileSync(eventPath, "utf8")) : {};
  const pullRequest = event.pull_request;
  const pullRequestNumber = Number(pullRequest?.number ?? event.number ?? 0);
  const commitSha = pullRequest?.head?.sha ?? process.env.GITHUB_SHA ?? "";
  const repository = process.env.GITHUB_REPOSITORY ?? pullRequest?.base?.repo?.full_name ?? "";
  const repositoryId = process.env.GITHUB_REPOSITORY_ID ?? String(pullRequest?.base?.repo?.id ?? "");
  if (!pullRequestNumber) throw new Error("Abyss Action must run for a pull request event");
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("GitHub commit SHA is missing or invalid");
  if (!repository || !repositoryId) throw new Error("GitHub repository context is missing");
  return { pullRequestNumber, commitSha, repository, repositoryId };
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function upload(base, key, applicationId, context, platform, file, versionName, versionCode) {
  const info = statSync(file);
  if (!info.isFile()) throw new Error(`Not a file: ${file}`);
  const name = basename(file);
  const digest = await sha256(file);
  console.log(`Uploading ${name} (${info.size} bytes)...`);
  const target = await request(base, key, "/v1/github-actions/artifacts", {
    method: "POST",
    body: JSON.stringify({
      applicationId,
      repositoryId: context.repositoryId,
      repositoryFullName: context.repository,
      pullRequestNumber: context.pullRequestNumber,
      commitSha: context.commitSha,
      ref: process.env.GITHUB_REF,
      workflowRunId: process.env.GITHUB_RUN_ID,
      workflowRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? "1"),
      platform,
      versionName: versionName || undefined,
      versionCode: versionCode || undefined,
      name,
      sizeBytes: info.size,
      sha256: digest,
    }),
  });
  if (target.alreadyUploaded) {
    const completed = await request(base, key, `/v1/github-actions/artifacts/${encodeURIComponent(target.artifactId)}/complete`, { method: "POST" });
    return { name, sizeBytes: info.size, sha256: digest, artifactId: target.artifactId, scanId: completed.scanId, s3Key: "", deduplicated: true };
  }
  const response = await fetch(target.upload.url, {
    method: "PUT",
    body: createReadStream(file),
    duplex: "half",
    headers: { "Content-Length": String(info.size) },
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  const completed = await request(base, key, `/v1/github-actions/artifacts/${encodeURIComponent(target.artifactId)}/complete`, { method: "POST" });
  return { name, sizeBytes: info.size, sha256: digest, artifactId: target.artifactId, scanId: completed.scanId, s3Key: target.upload.key, deduplicated: false };
}

async function run() {
  const key = input("api-key", { required: true });
  const base = (input("api-url") || "https://api.abyss.m1st.ai").replace(/\/$/, "");
  const applicationId = input("application-id", { required: true });
  const versionName = input("version-name");
  const versionCode = input("version-code");
  const android = input("android");
  const ios = input("ios");

  if (!android && !ios) throw new Error("Input 'android' or 'ios' is required");

  const context = githubContext();
  const androidResult = android ? await upload(base, key, applicationId, context, "ANDROID", android, versionName, versionCode) : undefined;
  const iosResult = ios ? await upload(base, key, applicationId, context, "IOS", ios, versionName, versionCode) : undefined;
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
