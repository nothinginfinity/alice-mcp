/**
 * alice-mcp — MCP server for Alice (Perplexity)
 * Exposes tools for agent-bridge coordination and afo-toolsmith API access.
 * Deployed as a Cloudflare Worker. Built by Claude.
 */

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO_BRIDGE: string;
  AFO_BASE_URL: string;
}

const TOOLS = [
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
  }
];

async function handleTool(name: string, args: Record<string, unknown>, env: Env): Promise<unknown> {
  const githubHeaders = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  switch (name) {
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
      // Read current file
      const readRes = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO_BRIDGE}/contents/${path}`, { headers: githubHeaders });
      if (!readRes.ok) throw new Error(`Read failed: ${readRes.status}`);
      const readData = await readRes.json() as { content: string; sha: string };
      const currentContent = atob(readData.content.replace(/\n/g, ""));
      const sha = readData.sha;
      // Build new message block
      const now = new Date().toISOString();
      const msgBlock = `## [${msg_id}] ${subject}\n**from:** alice\n**to:** ${target}\n**date:** ${now}\n**status:** unread\n**priority:** ${priority}\n\n${body}\n\n\u2014 Alice\n\n---\n\n`;
      // Prepend after header
      const headerEnd = currentContent.indexOf("---") + 3;
      const newContent = currentContent.slice(0, headerEnd) + "\n\n" + msgBlock + currentContent.slice(headerEnd).replace(/^\n+/, "");
      // Write back
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

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json({ name: "alice-mcp", version: "1.0.0", tools: TOOLS.map(t => t.name) });
    }

    // MCP endpoint
    if (url.pathname === "/mcp" && request.method === "POST") {
      let body: { jsonrpc: string; id: unknown; method: string; params?: { name?: string; arguments?: Record<string, unknown>; tools?: unknown } };
      try {
        body = await request.json();
      } catch {
        return Response.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, { status: 400 });
      }

      const { method, id, params } = body;

      if (method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
        if (!toolName) {
          return Response.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } });
        }
        try {
          const result = await handleTool(toolName, toolArgs, env);
          return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ jsonrpc: "2.0", id, error: { code: -32603, message: msg } });
        }
      }

      if (method === "initialize") {
        return Response.json({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "alice-mcp", version: "1.0.0" }
          }
        });
      }

      return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
    }

    return new Response("Not found", { status: 404 });
  }
};
