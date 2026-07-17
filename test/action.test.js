import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("uploads a binary, starts an analysis, waits, and writes outputs", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString() });

    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/uploads") response.end(JSON.stringify({ key: "uploads/app.apk", url: `${base}/upload` }));
    else if (request.url === "/upload") response.end("{}");
    else if (request.url === "/v1/analyses") response.end(JSON.stringify({ id: "analysis-1", status: "created" }));
    else if (request.url === "/v1/analyses/analysis-1/start") response.end(JSON.stringify({ id: "analysis-1", status: "running" }));
    else if (request.url === "/v1/analyses/analysis-1") response.end(JSON.stringify({ id: "analysis-1", status: "succeeded" }));
    else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), "abyss-action-"));
  const binary = join(directory, "app.apk");
  const output = join(directory, "output");
  await writeFile(binary, "mobile-binary");

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INPUT_API_KEY: "secret-key",
        INPUT_API_URL: base,
        INPUT_APPLICATION_ID: "app-1",
        INPUT_ANDROID: binary,
        INPUT_NAME: "CI analysis",
        INPUT_WAIT: "true",
        INPUT_INTERVAL: "0",
        GITHUB_OUTPUT: output,
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr }));
  });
  server.close();

  assert.equal(result.code, 0, result.stderr);
  assert.match(await readFile(output, "utf8"), /analysis-id=analysis-1/);
  assert.match(await readFile(output, "utf8"), /status=succeeded/);
  assert.equal(requests.find((item) => item.url === "/upload").body, "mobile-binary");
  assert.equal(JSON.parse(requests.find((item) => item.url === "/v1/analyses").body).applicationId, "app-1");
});
