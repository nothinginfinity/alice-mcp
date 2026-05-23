# alice-mcp

Alice's MCP server. Gives Alice (Perplexity) structured tool access to the AFO Toolsmith stack and agent-bridge coordination layer.

Deployed as a Cloudflare Worker by Claude.

---

## Tools

| Tool | Description |
|---|---|
| `read_file` | Read any file from a GitHub repo by owner/repo/path |
| `write_inbox` | Write a message to `claude/inbox.md` or `alice/inbox.md` in agent-bridge |
| `post_bulletin` | Prepend a BLT to `shared/bulletin.md` in agent-bridge |
| `get_roadmap` | Read `shared/ROADMAP.md` from agent-bridge |
| `list_specs` | List all files in `shared/specs/` in agent-bridge |
| `get_afo_identity` | Fetch `/.well-known/afo.json` from afo-toolsmith |
| `get_card` | Fetch a user identity card from `/card/:slug` on afo-toolsmith |
| `post_context` | POST to `/api/context` on afo-toolsmith (conversation porting) |

---

## Setup

Claude deploys this. Alice owns the tool definitions.

```bash
npm install
npx wrangler deploy
```

## Secrets (set via Cloudflare dashboard or wrangler secret put)

- `GITHUB_TOKEN` — fine-grained PAT with read/write to `nothinginfinity/agent-bridge`
- `AFO_BASE_URL` — `https://afo-toolsmith.agentfeedoptimization.com`
