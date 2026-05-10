#!/usr/bin/env node

/**
 * Swiss Cybersecurity MCP — stdio entry point.
 *
 * Provides MCP tools for querying NCSC-CH (Swiss National Cyber Security
 * Centre) guidelines, technical reports, security advisories, and Swiss
 * cybersecurity frameworks (ISDS, ISB recommendations).
 *
 * Tool prefix: ch_cyber_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { searchGuidance, getGuidance, searchAdvisories, getAdvisory, listFrameworks } from "./db.js";
import { buildCitation } from "./utils/citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string };
  pkgVersion = pkg.version;
} catch { /* fallback */ }

const SERVER_NAME = "swiss-cybersecurity-mcp";

const TOOLS = [
  {
    name: "ch_cyber_search_guidance",
    description: "Full-text search across NCSC-CH guidelines and technical reports. Covers Swiss ISB (Information Security in the Federal Administration) standards, NCSC-CH technical recommendations, NIS Act (ISG) implementation guides, and MELANI/NCSC reports. Returns matching documents with reference, title, series, and summary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query in German (e.g., 'Verschlüsselung TLS', 'ISG Mindestmassnahmen', 'Patch Management')" },
        type: { type: "string", enum: ["technical_guideline", "isb_standard", "technical_report", "recommendation"], description: "Filter by document type. Optional." },
        series: { type: "string", enum: ["ISB", "NCSC-CH", "ISG"], description: "Filter by series. Optional." },
        status: { type: "string", enum: ["current", "superseded", "draft"], description: "Filter by document status. Optional." },
        limit: { type: "number", description: "Maximum number of results to return. Defaults to 20." },
      },
      required: ["query"],
    },
  },
  {
    name: "ch_cyber_get_guidance",
    description: "Get a specific NCSC-CH guidance document by reference (e.g., 'ISB-2023-01', 'NCSC-CH-TLP-2024-01').",
    inputSchema: { type: "object" as const, properties: { reference: { type: "string", description: "Document reference" } }, required: ["reference"] },
  },
  {
    name: "ch_cyber_search_advisories",
    description: "Search NCSC-CH security advisories and warnings. Returns advisories with severity, affected products, and CVE references where available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query in German (e.g., 'kritische Schwachstelle', 'Ransomware', 'Phishing')" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Filter by severity level. Optional." },
        limit: { type: "number", description: "Maximum number of results to return. Defaults to 20." },
      },
      required: ["query"],
    },
  },
  {
    name: "ch_cyber_get_advisory",
    description: "Get a specific NCSC-CH security advisory by reference (e.g., 'NCSC-CH-2024-0001').",
    inputSchema: { type: "object" as const, properties: { reference: { type: "string", description: "NCSC-CH advisory reference" } }, required: ["reference"] },
  },
  {
    name: "ch_cyber_list_frameworks",
    description: "List all NCSC-CH frameworks and standard series covered in this MCP, including ISB standards, ISG (Informationssicherheitsgesetz) implementation, and NCSC-CH advisory series.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "ch_cyber_about",
    description: "Return metadata about this MCP server: version, data source, coverage, and tool list.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
];

const SearchGuidanceArgs = z.object({
  query: z.string().min(1),
  type: z.enum(["technical_guideline", "isb_standard", "technical_report", "recommendation"]).optional(),
  series: z.enum(["ISB", "NCSC-CH", "ISG"]).optional(),
  status: z.enum(["current", "superseded", "draft"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});
const GetGuidanceArgs = z.object({ reference: z.string().min(1) });
const SearchAdvisoriesArgs = z.object({
  query: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});
const GetAdvisoryArgs = z.object({ reference: z.string().min(1) });

function textContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function errorContent(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

const server = new Server({ name: SERVER_NAME, version: pkgVersion }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case "ch_cyber_search_guidance": {
        const parsed = SearchGuidanceArgs.parse(args);
        const results = searchGuidance({ query: parsed.query, type: parsed.type, series: parsed.series, status: parsed.status, limit: parsed.limit });
        return textContent({ results, count: results.length });
      }
      case "ch_cyber_get_guidance": {
        const parsed = GetGuidanceArgs.parse(args);
        const doc = getGuidance(parsed.reference);
        if (!doc) return errorContent(`Guidance document not found: ${parsed.reference}`);
        const _citation = buildCitation(
          parsed.reference,
          (doc as unknown as Record<string, unknown>).title as string || parsed.reference,
          "ch_cyber_get_guidance",
          { reference: parsed.reference },
        );
        return textContent({ ...doc as unknown as Record<string, unknown>, _citation });
      }
      case "ch_cyber_search_advisories": {
        const parsed = SearchAdvisoriesArgs.parse(args);
        const results = searchAdvisories({ query: parsed.query, severity: parsed.severity, limit: parsed.limit });
        return textContent({ results, count: results.length });
      }
      case "ch_cyber_get_advisory": {
        const parsed = GetAdvisoryArgs.parse(args);
        const advisory = getAdvisory(parsed.reference);
        if (!advisory) return errorContent(`Advisory not found: ${parsed.reference}`);
        const _citation = buildCitation(
          parsed.reference,
          (advisory as unknown as Record<string, unknown>).title as string || parsed.reference,
          "ch_cyber_get_advisory",
          { reference: parsed.reference },
        );
        return textContent({ ...advisory as unknown as Record<string, unknown>, _citation });
      }
      case "ch_cyber_list_frameworks": {
        const frameworks = listFrameworks();
        return textContent({ frameworks, count: frameworks.length });
      }
      case "ch_cyber_about":
        return textContent({
          name: SERVER_NAME, version: pkgVersion,
          description: "NCSC-CH (Swiss National Cyber Security Centre) MCP server. Provides access to Swiss ISB standards for federal administration, ISG (Informationssicherheitsgesetz) implementation guides, NCSC-CH technical recommendations, and security advisories.",
          data_source: "NCSC-CH (https://www.ncsc.admin.ch/) and ISB (https://www.isb.admin.ch/)",
          coverage: { guidance: "ISB standards (federal ICT standards), ISG implementation guides, NCSC-CH technical recommendations, MELANI/NCSC threat reports", advisories: "NCSC-CH security advisories and warnings", frameworks: "ISB standards, ISG, NCSC-CH advisory series" },
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      default:
        return errorContent(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorContent(`Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
