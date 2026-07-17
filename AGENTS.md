# AGENTS.md

## Scope

This public repository contains the reusable GitHub Action for uploading customer mobile binaries to Abyss.

## Source of truth

- `m1st-ai/abyss-app` is private. This Action must remain standalone and must not fetch, import, or expose files from that repository at runtime.
- Keep the `/v1/uploads` request, Bearer authentication, and signed-URL PUT behavior compatible with the Abyss public API.
- This Action uploads binaries only. It must not create or start an analysis.
- Action-specific input validation, GitHub outputs, annotations, and failure semantics belong in this repository.

## Development

- The checked-in `dist/index.js` is the code executed by GitHub Actions and must be included in every behavior-changing commit.
- The action intentionally has no runtime npm dependencies. Use Node.js 24 built-ins and web APIs.
- Run `npm test` after changing action behavior.
- Keep `action.yml`, `README.md`, tests, and runtime behavior synchronized when adding or changing an input or output.

## Security

- Never print, persist, or pass the API key as a command-line argument. Read it from `INPUT_API_KEY` and use it only in the Authorization header.
- Do not include binary contents, signed upload URLs, Authorization headers, or secrets in logs or errors.
- Treat all input paths and API responses as untrusted and validate them before use.

## Releases

- Release immutable SemVer tags and update the matching major tag for consumers.
- Before tagging, verify the action in a workflow against the intended Abyss API environment.
