/**
 * alice-mcp — MCP server for Alice (Perplexity)
 * Exposes tools for agent-bridge coordination, afo-toolsmith API access,
 * and Cloudflare account management.
 * Deployed as a Cloudflare Worker. Built by Claude + Alice.
 */

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO_BRIDGE: string;
  AFO_BASE_URL: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
}

const TOOLS = [
  // ── GitHub / Agent-Bridge tools ──────────────────────────────────────────
  {
    name: "read_file",
    description: "Read any file from a GitHub repository by owner, repo, and path. Returns decoded text content and the current SHA (needed for writes).",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "GitHub repo owner" },
        repo: { type: "string", description: "GitHub repo name" },
        path: { type: "string", description: "File path within the repo" },
        ref: { type: "string", description: "Branch or SHA (default: main)" }
      },
      required: ["owner", "repo", "path"]
    }
  },
  {
    name: "write_inbox",
    description: "Prepend a formatted MSG to claude/inbox.md or alice/inbox.md in agent-bridge. Always reads current SHA first to avoid conflicts.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["claude", "alice"], description: "Whose inbox to write to" },
        msg_id: { type: "string", description: "Message ID e.g. MSG-A-011" },
        subject: { type: "string", description: "Subject slug e.g. resume-phase6" },
        priority: { type: "string", enum: ["normal", "high"], description: "Message priority" },
        body: { type: "string", description: "Full message body (markdown)" }
      },
      required: ["target", "msg_id", "subject", "priority", "body"]
    }
  },
  {
    name: "post_bulletin",
    description: "Prepend a BLT to shared/bulletin.md in agent-bridge. Always reads current content first.",
    inputSchema: {
      type: "object",
      properties: {
        blt_id: { type: "string", description: "BLT ID e.g. BLT-010" },
        subject: { type: "string", description: "Subject slug" },
        audience: { type: "string", description: "e.g. alice, claude, jared" },
        body: { type: "string", description: "BLT body (markdown)" }
      },
      required: ["blt_id", "subject", "audience", "body"]
    }
  },
  {
    name: "get_roadmap",
    description: "Read shared/ROADMAP.md from agent-bridge. Returns current phase, build queue, and project status.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "list_specs",
    description: "List all spec files in shared/specs/ in agent-bridge.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_afo_identity",
    description: "Fetch /.well-known/afo.json from afo-toolsmith. Returns the full AFO identity payload including contact info, product description, and LLM instructions.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_card",
    description: "Fetch the identity card page for a user slug from afo-toolsmith (e.g. /card/jared).",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "User slug e.g. jared" }
      },
      required: ["slug"]
    }
  },
  {
    name: "post_context",
    description: "POST a conversation context capsule to /api/context on afo-toolsmith. Used for conversation porting (Addendum A of afo-page-harness spec). Returns a ctx token and /chat URL.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Summary of the conversation context" },
        intent: { type: "string", description: "What the user is trying to do" },
        suggested_action: { type: "string", description: "Suggested next step for Jared" },
        user_name: { type: "string", description: "Optional user name" },
        user_contact: { type: "string", description: "Optional user contact info" }
      },
      required: ["summary", "intent"]
    }
  },

  // ── Cloudflare tools ─────────────────────────────────────────────────────
  {
    name: "cf_list_zones",
    description: "List all Cloudflare zones (domains) on the account. Returns zone IDs, names, and statuses. Use this first to get a zone_id before other cf_ tools.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Filter by domain name (optional)" }
      },
      required: []
    }
  },
  {
    name: "cf_list_dns",
    description: "List DNS records for a Cloudflare zone. Returns type, name, content, TTL, proxied status, and record ID for each record.",
    inputSchema: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Cloudflare zone ID (get from cf_list_zones)" },
        type: { type: "string", description: "Filter by record type e.g. A, CNAME, MX, TXT (optional)" },
        name: { type: "string", description: "Filter by record name (optional)" }
      },
      required: ["zone_id"]
    }
  },
  {
    name: "cf_create_dns",
    description: "Create a new DNS record in a Cloudflare zone.",
    inputSchema: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Cloudflare zone ID" },
        type: { type: "string", description: "Record type: A, AAAA, CNAME, MX, TXT, etc." },
        name: { type: "string", description: "Record name e.g. @ or subdomain.example.com" },
        content: { type: "string", description: "Record value e.g. IP address or target hostname" },
        ttl: { type: "number", description: "TTL in seconds. Use 1 for automatic." },
        proxied: { type: "boolean", description: "Whether to proxy through Cloudflare (orange cloud). Default false." }
      },
      required: ["zone_id", "type", "name", "content", "ttl"]
    }
  },
  {
    name: "cf_patch_dns",
    description: "Update an existing DNS record in a Cloudflare zone. Only fields provided will be changed.",
    inputSchema: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Cloudflare zone ID" },
        record_id: { type: "string", description: "DNS record ID (get from cf_list_dns)" },
        type: { type: "string", description: "Record type (optional)" },
        name: { type: "string", description: "Record name (optional)" },
        content: { type: "string", description: "Record value (optional)" },
        ttl: { type: "number", description: "TTL in seconds (optional)" },
        proxied: { type: "boolean", description: "Proxied status (optional)" }
      },
      required: ["zone_id", "record_id"]
    }
  },
  {
    name: "cf_delete_dns",
    description: "Delete a DNS record from a Cloudflare zone. This is irreversible — confirm zone_id and record_id carefully.",
    inputSchema: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Cloudflare zone ID" },
        record_id: { type: "string", description: "DNS record ID to delete (get from cf_list_dns)" }
      },
      required: ["zone_id", "record_id"]
    }
  },
  {
    name: "cf_purge_cache",
    description: "Purge Cloudflare cache for a zone. Pass specific URLs to purge selectively, or set purge_all=true to clear everything.",
    inputSchema: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Cloudflare zone ID" },
        purge_all: { type: "boolean", description: "If true, purges entire cache. Use with caution." },
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Specific URLs to purge (used when purge_all is false)"
        }
      },
      required: ["zone_id"]
    }
  }
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

async function handleTool(name: string, args: Record<string, unknown>, env: Env): Promise<unknown> {
  const githubHeaders = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const cfHeaders = {
    "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json"
  };

  switch (name) {
    // ── GitHub / Agent-Bridge ─────────────────────────────────────────────

    case "read_file": {
      const { owner, repo, path, ref = "main" } = args as { owner: string; repo: string; path: string; ref?: string };
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`, { headers: githubHeaders });
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
      const data = await res.json() as { content: string; sha: string; encoding: string };
      const content = atob(data.content.replace(/\n/g, ""));
      return { content, sha: data.sha };
    }

    case "write_inbox": {
      const { target, msg_id, subject, priority, body } = args as { target: string; msg_id: string; subject: string; priority: string; body: string };
      const path = `${target}/inbox.md`;
      const readRes = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO_BRIDGE}/contents/${path}`, { headers: githubHeaders });
      if (!readRes.ok) throw new Error(`Read failed: ${readRes.status}`);
      const readData = await readRes.json() as { content: string; sha: string };
      const currentContent = atob(readData.content.replace(/\n/g, ""));
      const sha = readData.sha;
      const now = new Date().toISOString();
      const msgBlock = `## [${msg_id}] ${subject}\n**from:** alice\n**to:** ${target}\n**date:** ${now}\n**status:** unread\n**priority:** ${priority}\n\n${body}\n\n— Alice\n\n---\n\n`;
      const headerEnd = currentContent.indexOf("---") + 3;
      const newContent = currentContent.slice(0, headerEnd) + "\n\n" + msgBlock + currentContent.slice(headerEnd).replace(/^\n+/, "");
      const writeRes = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO_BRIDGE}/contents/${path}`, {
        method: "PUT",
        headers: { ...githubHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `${msg_id} — ${subject}`, content: btoa(unescape(encodeURIComponent(newContent))), sha })
      });
      if (!writeRes.ok) throw new Error(`Write failed: ${writeRes.status}: ${await writeRes.text()}`);
      return { ok: true, msg_id, target };
    }

    case "post_bulletin": {
      const { blt_id, subject, audience, body } = args as { blt_id: string; subject: string; audience: string; body: string };
      const path = "shared/bulletin.md";
      const readRes = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO_BRIDGE}/contents/${path}`, { headers: githubHeaders });
      if (!readRes.ok) throw new Error(`Read failed: ${readRes.status}`);
      const readData = await readRes.json() as { content: string; sha: string };
      const currentContent = atob(readData.content.replace(/\n/g, ""));
      const sha = readData.sha;
      const now = new Date().toISOString();
      const bltBlock = `## [${blt_id}] ${subject}\n**from:** alice\n**date:** ${now}\n**audience:** ${audience}\n\n${body}\n\n---\n\n`;
      const headerEnd = currentContent.indexOf("---") + 3;
      const newContent = currentContent.slice(0, headerEnd) + "\n\n" + bltBlock + currentContent.slice(headerEnd).replace(/^\n+/, "");
      const writeRes = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO_BRIDGE}/contents/${path}`, {
        method: "PUT",
        headers: { ...githubHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `${blt_id} — ${subject}`, content: btoa(unescape(encodeURIComponent(newContent))), sha })
      });
      if (!writeRes.ok) throw new Error(`Write failed: ${writeRes.status}: ${await writeRes.text()}`);
      return { ok: true, blt_id };
    }

    case "get_roadmap": {
      const res = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO_BRIDGE}/contents/shared/ROADMAP.md`, { headers: githubHeaders });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const data = await res.json() as { content: string };
      return { content: atob(data.content.replace(/\n/g, "")) };
    }

    case "list_specs": {
      const res = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO_BRIDGE}/contents/shared/specs`, { headers: githubHeaders });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const data = await res.json() as Array<{ name: string; size: number; html_url: string }>;
      return { specs: data.filter(f => f.name !== ".gitkeep").map(f => ({ name: f.name, size: f.size, url: f.html_url })) };
    }

    case "get_afo_identity": {
      const res = await fetch(`${env.AFO_BASE_URL}/.well-known/afo.json`);
      if (!res.ok) throw new Error(`AFO ${res.status}`);
      return await res.json();
    }

    case "get_card": {
      const { slug } = args as { slug: string };
      const res = await fetch(`${env.AFO_BASE_URL}/card/${slug}`);
      if (!res.ok) throw new Error(`Card ${res.status}`);
      return { html: await res.text(), url: `${env.AFO_BASE_URL}/card/${slug}` };
    }

    case "post_context": {
      const res = await fetch(`${env.AFO_BASE_URL}/api/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      if (!res.ok) throw new Error(`Context API ${res.status}: ${await res.text()}`);
      return await res.json();
    }

    // ── Cloudflare ────────────────────────────────────────────────────────

    case "cf_list_zones": {
      const { name } = args as { name?: string };
      const qs = name ? `?name=${encodeURIComponent(name)}` : "";
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones${qs}`, { headers: cfHeaders });
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`);
      const data = await res.json() as { result: Array<{ id: string; name: string; status: string; plan: { name: string } }> };
      return { zones: data.result.map(z => ({ id: z.id, name: z.name, status: z.status, plan: z.plan?.name })) };
    }

    case "cf_list_dns": {
      const { zone_id, type, name } = args as { zone_id: string; type?: string; name?: string };
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (name) params.set("name", name);
      params.set("per_page", "100");
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records?${params}`, { headers: cfHeaders });
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`);
      const data = await res.json() as { result: Array<{ id: string; type: string; name: string; content: string; ttl: number; proxied: boolean }> };
      return { records: data.result.map(r => ({ id: r.id, type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied })) };
    }

    case "cf_create_dns": {
      const { zone_id, type, name, content, ttl, proxied = false } = args as { zone_id: string; type: string; name: string; content: string; ttl: number; proxied?: boolean };
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records`, {
        method: "POST",
        headers: cfHeaders,
        body: JSON.stringify({ type, name, content, ttl, proxied })
      });
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`);
      const data = await res.json() as { result: { id: string; name: string; type: string; content: string } };
      return { ok: true, record: data.result };
    }

    case "cf_patch_dns": {
      const { zone_id, record_id, ...patch } = args as { zone_id: string; record_id: string; [key: string]: unknown };
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records/${record_id}`, {
        method: "PATCH",
        headers: cfHeaders,
        body: JSON.stringify(patch)
      });
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`);
      const data = await res.json() as { result: { id: string; name: string; type: string; content: string } };
      return { ok: true, record: data.result };
    }

    case "cf_delete_dns": {
      const { zone_id, record_id } = args as { zone_id: string; record_id: string };
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records/${record_id}`, {
        method: "DELETE",
        headers: cfHeaders
      });
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`);
      return { ok: true, deleted_id: record_id };
    }

    case "cf_purge_cache": {
      const { zone_id, purge_all = false, urls } = args as { zone_id: string; purge_all?: boolean; urls?: string[] };
      const body = purge_all ? { purge_everything: true } : { files: urls ?? [] };
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/purge_cache`, {
        method: "POST",
        headers: cfHeaders,
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`);
      return { ok: true, purge_all, urls: urls ?? [] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "*";

    // CORS preflight — Perplexity sends OPTIONS before every request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    // OAuth Protected Resource Metadata — required by Perplexity MCP client
    // Returns "no auth required" so registration succeeds without OAuth flow
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return Response.json(
        {
          resource: `${url.origin}/mcp`,
          authorization_servers: [],
          bearer_methods_supported: [],
          resource_documentation: `${url.origin}/`
        },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } }
      );
    }

    // OAuth Authorization Server Metadata — Perplexity falls back to this
    // Declares no auth required (no token endpoint, no grants)
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return Response.json(
        {
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/oauth/authorize`,
          token_endpoint: `${url.origin}/oauth/token`,
          response_types_supported: ["code"],
          grant_types_supported: [],
          token_endpoint_auth_methods_supported: ["none"],
          registration_endpoint: `${url.origin}/oauth/register`,
          scopes_supported: [],
          code_challenge_methods_supported: ["S256"]
        },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } }
      );
    }

    // OAuth Dynamic Client Registration — Perplexity tries to auto-register
    // Accept any registration and return a static client_id
    if (url.pathname === "/oauth/register" && request.method === "POST") {
      return Response.json(
        {
          client_id: "perplexity-alice-mcp",
          client_secret: null,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          grant_types: ["authorization_code"],
          redirect_uris: [],
          token_endpoint_auth_method: "none"
        },
        { status: 201, headers: CORS_HEADERS }
      );
    }

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json(
        { name: "alice-mcp", version: "1.2.0", tools: TOOLS.map(t => t.name) },
        { headers: CORS_HEADERS }
      );
    }

    // MCP endpoint
    if (url.pathname === "/mcp" && request.method === "POST") {
      let body: { jsonrpc: string; id: unknown; method: string; params?: { name?: string; arguments?: Record<string, unknown>; tools?: unknown } };
      try {
        body = await request.json();
      } catch {
        return Response.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, { status: 400, headers: CORS_HEADERS });
      }

      const { method, id, params } = body;

      if (method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } }, { headers: CORS_HEADERS });
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
        if (!toolName) {
          return Response.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } }, { headers: CORS_HEADERS });
        }
        try {
          const result = await handleTool(toolName, toolArgs, env);
          return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } }, { headers: CORS_HEADERS });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ jsonrpc: "2.0", id, error: { code: -32603, message: msg } }, { headers: CORS_HEADERS });
        }
      }

      if (method === "initialize") {
        return Response.json({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "alice-mcp", version: "1.2.0" }
          }
        }, { headers: CORS_HEADERS });
      }

      return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } }, { headers: CORS_HEADERS });
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }
};
