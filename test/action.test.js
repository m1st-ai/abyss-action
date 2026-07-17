import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("uploads a binary and writes its metadata to outputs", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString() });

    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/ci/artifacts") response.end(JSON.stringify({ artifactId: "artifact-1", alreadyUploaded: false, upload: { key: "ci-artifacts/app.apk", url: `${base}/upload` } }));
    else if (request.url === "/upload") response.end("{}");
    else if (request.url === "/v1/ci/artifacts/artifact-1/complete") response.end(JSON.stringify({ scanId: "scan-1" }));
    else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), "abyss-action-"));
  const binary = join(directory, "app.apk");
  const output = join(directory, "output");
  const eventPath = join(directory, "event.json");
  await writeFile(binary, "mobile-binary");
  await writeFile(eventPath, JSON.stringify({ number: 42, pull_request: { number: 42, head: { sha: "a".repeat(40) }, base: { repo: { id: 123, full_name: "customer/mobile" } } } }));

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INPUT_API_KEY: "secret-key",
        INPUT_API_URL: base,
        INPUT_APPLICATION_ID: "app-1",
        INPUT_ANDROID: binary,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "customer/mobile",
        GITHUB_REPOSITORY_ID: "123",
        GITHUB_SHA: "a".repeat(40),
        GITHUB_RUN_ID: "999",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_OUTPUT: output,
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr }));
  });
  server.close();

  assert.equal(result.code, 0, result.stderr);
  const outputs = await readFile(output, "utf8");
  assert.match(outputs, /android-key<<[^\n]+\nci-artifacts\/app\.apk\n/);
  assert.match(outputs, /android-scan-id<<[^\n]+\nscan-1\n/);
  assert.match(outputs, /android<<[^\n]+\n\{"name":"app\.apk","sizeBytes":13,"sha256":"[0-9a-f]{64}","artifactId":"artifact-1","scanId":"scan-1","s3Key":"ci-artifacts\/app\.apk","deduplicated":false\}\n/);
  assert.match(outputs, /ios<<[^\n]+\n\n/);
  assert.equal(requests.find((item) => item.url === "/upload").body, "mobile-binary");
  assert.equal(requests.find((item) => item.url === "/upload").method, "PUT");
  assert.equal(requests.filter((item) => item.url === "/v1/ci/artifacts").length, 1);
  const registration = JSON.parse(requests.find((item) => item.url === "/v1/ci/artifacts").body);
  assert.equal(registration.applicationId, "app-1");
  assert.equal(registration.pullRequestNumber, 42);
  assert.equal(registration.commitSha, "a".repeat(40));
  assert.equal(requests.some((item) => item.url.startsWith("/v1/analyses")), false);
});
