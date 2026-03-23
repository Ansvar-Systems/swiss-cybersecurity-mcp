#!/usr/bin/env npx tsx
/**
 * Ingestion crawler for the Swiss NCSC (ncsc.admin.ch) cybersecurity MCP.
 *
 * Crawls four content streams from the Swiss National Cyber Security Centre
 * (Bundesamt fuer Cybersicherheit / BACS):
 *
 *   1. Weekly reviews  (Wochenrueckblicke)  → guidance table
 *   2. Warnings        (Warnungen)          → advisories table
 *   3. Technical reports (Fachberichte)      → guidance table
 *   4. Situation reports (Lageberichte)      → guidance table
 *
 * Content is fetched in German (primary), with English titles where the
 * English page exists.
 *
 * Usage:
 *   npx tsx scripts/ingest-ncsc-ch.ts
 *   npx tsx scripts/ingest-ncsc-ch.ts --resume
 *   npx tsx scripts/ingest-ncsc-ch.ts --dry-run
 *   npx tsx scripts/ingest-ncsc-ch.ts --force
 *   npx tsx scripts/ingest-ncsc-ch.ts --stream warnings
 *   npx tsx scripts/ingest-ncsc-ch.ts --stream weekly --year 2025
 */

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESUME = args.includes("--resume");
const FORCE = args.includes("--force");
const streamIdx = args.indexOf("--stream");
const STREAM_FILTER = streamIdx !== -1 ? (args[streamIdx + 1] ?? null) : null;
const yearIdx = args.indexOf("--year");
const YEAR_FILTER = yearIdx !== -1 ? parseInt(args[yearIdx + 1] ?? "", 10) : null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE = "https://www.ncsc.admin.ch";
const DB_PATH = process.env["NCSC_CH_DB_PATH"] ?? "data/ncsc-ch.db";
const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;
const USER_AGENT =
  "AnsvarBot/1.0 (+https://ansvar.eu; ingestion crawler for cybersecurity research)";

// Year range for weekly reviews — NCSC started weekly reviews around 2020
const WEEKLY_START_YEAR = 2020;
const CURRENT_YEAR = new Date().getFullYear();

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

function openDb(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (FORCE && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    log("Deleted existing database (--force)");
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const startTime = Date.now();

function log(msg: string): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stderr.write(`[${elapsed}s] ${msg}\n`);
}

function logProgress(stream: string, current: number, total: number, ref: string): void {
  const pct = total > 0 ? ((current / total) * 100).toFixed(0) : "?";
  log(`[${stream}] ${current}/${total} (${pct}%) — ${ref}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "de-CH,de;q=0.9,en;q=0.5,fr;q=0.3",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.status === 404) {
        return null;
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }
      return await resp.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        const backoff = RETRY_BACKOFF_MS * attempt;
        log(`  Retry ${attempt}/${retries} for ${url}: ${msg} — waiting ${backoff}ms`);
        await sleep(backoff);
      } else {
        log(`  FAILED after ${retries} attempts: ${url} — ${msg}`);
        return null;
      }
    }
  }
  return null;
}

async function fetchPage(url: string): Promise<cheerio.CheerioAPI | null> {
  const html = await fetchWithRetry(url);
  if (!html) return null;
  return cheerio.load(html);
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Parse Swiss date format "DD.MM.YYYY" to ISO "YYYY-MM-DD". */
function parseSwissDate(text: string): string | null {
  const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Extract date from page content — tries multiple patterns. */
function extractDate($: cheerio.CheerioAPI): string | null {
  // Pattern 1: Swiss admin sites often have a date in the article header
  const bodyText = $(".col-sm-12, .mod-body, #content, .article, main, body").first().text();

  // Look for DD.MM.YYYY pattern early in the text
  const dateMatch = bodyText.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (dateMatch?.[1]) return parseSwissDate(dateMatch[1]);

  // Pattern 2: "Last modification" metadata
  const modText = $('*:contains("Last modification"), *:contains("Letzte Änderung")').last().text();
  const modMatch = modText.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (modMatch?.[1]) return parseSwissDate(modMatch[1]);

  return null;
}

/** Extract main article text from an NCSC page. */
function extractArticleText($: cheerio.CheerioAPI): string {
  // Swiss admin pages use various content wrappers
  const selectors = [
    "#content .mod-body",
    "#content article",
    ".mod-text",
    "#content .container-fluid",
    "#content",
    "main",
  ];

  for (const sel of selectors) {
    const el = $(sel);
    if (el.length > 0) {
      // Remove navigation, sidebar, footer elements
      el.find("nav, .nav, .mod-pagenav, .mod-paging, footer, .footer, script, style, .breadcrumb").remove();
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length > 100) return text;
    }
  }

  // Fallback: concatenate all paragraphs
  const paragraphs: string[] = [];
  $("p").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 20) paragraphs.push(t);
  });
  return paragraphs.join("\n\n");
}

/** Extract h1 title. */
function extractTitle($: cheerio.CheerioAPI): string {
  return ($("h1").first().text() || $("title").first().text() || "").trim();
}

/**
 * Build a short summary from the first ~300 characters of content,
 * or from a meta description if available.
 */
function buildSummary($: cheerio.CheerioAPI, fullText: string): string {
  const meta = $('meta[name="description"]').attr("content")?.trim();
  if (meta && meta.length > 30) return meta;
  // First paragraph as summary
  const firstP = $("p").first().text().trim();
  if (firstP.length > 30 && firstP.length < 600) return firstP;
  // Truncate full text
  if (fullText.length > 300) return fullText.slice(0, 297) + "...";
  return fullText;
}

// ---------------------------------------------------------------------------
// Stream: Weekly Reviews (Wochenrueckblicke) → guidance
// ---------------------------------------------------------------------------

interface WeeklyUrl {
  year: number;
  week: number;
  urlDe: string;
  urlEn: string;
}

function generateWeeklyUrls(): WeeklyUrl[] {
  const urls: WeeklyUrl[] = [];
  for (let year = WEEKLY_START_YEAR; year <= CURRENT_YEAR; year++) {
    if (YEAR_FILTER && year !== YEAR_FILTER) continue;
    // Weeks 1-52 (some years go to 53, but most stop at 52)
    const maxWeek = 53;
    for (let week = 1; week <= maxWeek; week++) {
      urls.push({
        year,
        week,
        urlDe: `${BASE}/ncsc/de/home/aktuell/im-fokus/${year}/wochenrueckblick_${week}.html`,
        urlEn: `${BASE}/ncsc/en/home/aktuell/im-fokus/${year}/wochenrueckblick_${week}.html`,
      });
    }
  }
  return urls;
}

async function ingestWeeklyReviews(db: Database.Database): Promise<number> {
  log("=== Stream: Weekly Reviews (Wochenrueckblicke) ===");
  const urls = generateWeeklyUrls();
  const total = urls.length;
  let ingested = 0;
  let skipped = 0;
  let notFound = 0;

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO guidance
     (reference, title, title_en, date, type, series, summary, full_text, topics, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const existsStmt = db.prepare("SELECT 1 FROM guidance WHERE reference = ?");

  for (let i = 0; i < urls.length; i++) {
    const entry = urls[i]!;
    const { year, week, urlDe, urlEn } = entry;
    const reference = `NCSC-CH-WR-${year}-W${String(week).padStart(2, "0")}`;

    logProgress("weekly", i + 1, total, reference);

    // Resume: skip if already in DB
    if (RESUME && existsStmt.get(reference)) {
      skipped++;
      continue;
    }

    // Fetch German page (primary content)
    const $de = await fetchPage(urlDe);
    await sleep(RATE_LIMIT_MS);

    if (!$de) {
      notFound++;
      continue;
    }

    const title = extractTitle($de);
    if (!title) {
      notFound++;
      continue;
    }
    const fullText = extractArticleText($de);
    if (fullText.length < 50) {
      notFound++;
      continue;
    }

    const date = extractDate($de);
    const summary = buildSummary($de, fullText);

    // Fetch English title
    let titleEn: string | null = null;
    const $en = await fetchPage(urlEn);
    await sleep(RATE_LIMIT_MS);
    if ($en) {
      titleEn = extractTitle($en);
    }

    const topics = JSON.stringify(["Wochenrueckblick", "Cybersicherheit", "Schweiz", `${year}`]);

    if (!DRY_RUN) {
      insertStmt.run(reference, title, titleEn, date, "weekly_review", "NCSC-CH", summary, fullText, topics, "current");
    }
    ingested++;
    log(`  + ${reference}: ${title.slice(0, 80)}`);
  }

  log(`Weekly reviews: ${ingested} ingested, ${skipped} skipped (resume), ${notFound} not found`);
  return ingested;
}

// ---------------------------------------------------------------------------
// Stream: Warnings (Warnungen) → advisories
// ---------------------------------------------------------------------------

interface WarningLink {
  url: string;
  title: string;
  date: string | null;
}

async function collectWarningLinks(): Promise<WarningLink[]> {
  const links: WarningLink[] = [];
  const indexUrl = `${BASE}/ncsc/de/home/aktuell/im-fokus/warnungen.html`;
  const $ = await fetchPage(indexUrl);
  await sleep(RATE_LIMIT_MS);
  if (!$) {
    log("  Failed to fetch warnings index page");
    return links;
  }

  // Each warning is an <a> within the content area
  $("a[href*='/im-fokus/']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || !text || text.length < 10) return;
    // Filter to actual warning articles, skip index/navigation links
    if (href.includes("wochenrueckblick") || href.includes("warnungen.html")) return;
    if (!href.match(/\/\d{4}\//)) return;

    const fullUrl = href.startsWith("http") ? href : `${BASE}${href}`;
    // Try to find a date near this link
    const parent = $(el).closest("li, div, article, section");
    const parentText = parent.text();
    const dateMatch = parentText.match(/(\d{2}\.\d{2}\.\d{4})/);

    links.push({
      url: fullUrl,
      title: text,
      date: dateMatch?.[1] ? parseSwissDate(dateMatch[1]) : null,
    });
  });

  // Deduplicate by URL
  const seen = new Set<string>();
  return links.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

async function ingestWarnings(db: Database.Database): Promise<number> {
  log("=== Stream: Warnings (Warnungen) → advisories ===");
  const links = await collectWarningLinks();
  log(`Found ${links.length} warning links`);

  let ingested = 0;
  let skipped = 0;

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO advisories
     (reference, title, date, severity, affected_products, summary, full_text, cve_references)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const existsStmt = db.prepare("SELECT 1 FROM advisories WHERE reference = ?");

  for (let i = 0; i < links.length; i++) {
    const link = links[i]!;
    // Build a reference from the URL path
    const pathMatch = link.url.match(/\/(\d{4})\/([\w-]+)\.html$/);
    const slug = pathMatch?.[2] ?? `warning-${i}`;
    const year = pathMatch?.[1] ?? "unknown";
    const reference = `NCSC-CH-WARN-${year}-${slug}`;

    logProgress("warnings", i + 1, links.length, reference);

    if (RESUME && existsStmt.get(reference)) {
      skipped++;
      continue;
    }

    const $ = await fetchPage(link.url);
    await sleep(RATE_LIMIT_MS);
    if (!$) continue;

    const title = extractTitle($) || link.title;
    const fullText = extractArticleText($);
    if (fullText.length < 50) continue;

    const date = link.date || extractDate($);
    const summary = buildSummary($, fullText);

    // Try to extract severity from text
    const severity = detectSeverity(fullText, title);

    // Try to extract CVE references
    const cves = extractCVEs(fullText);

    // Try to extract affected products
    const products = extractAffectedProducts(fullText, title);

    if (!DRY_RUN) {
      insertStmt.run(
        reference,
        title,
        date,
        severity,
        products,
        summary,
        fullText,
        cves || null,
      );
    }
    ingested++;
    log(`  + ${reference}: ${title.slice(0, 80)}`);
  }

  log(`Warnings: ${ingested} ingested, ${skipped} skipped (resume)`);
  return ingested;
}

function detectSeverity(text: string, title: string): string {
  const combined = (title + " " + text).toLowerCase();
  if (combined.includes("kritisch") || combined.includes("critical") || combined.includes("sofortiger handlungsbedarf")) return "critical";
  if (combined.includes("hoch") || combined.includes("high") || combined.includes("dringend")) return "high";
  if (combined.includes("mittel") || combined.includes("medium") || combined.includes("moderate")) return "medium";
  if (combined.includes("niedrig") || combined.includes("low") || combined.includes("gering")) return "low";
  return "high"; // Warnings are generally high-severity by nature
}

function extractCVEs(text: string): string | null {
  const cves = text.match(/CVE-\d{4}-\d{4,}/g);
  if (!cves || cves.length === 0) return null;
  return [...new Set(cves)].join(", ");
}

function extractAffectedProducts(text: string, title: string): string | null {
  // Look for common product patterns in warnings
  const products: string[] = [];
  const patterns = [
    /(?:betrifft|affects|betroffene?\s+(?:Produkte?|Software|Systeme?|Versionen?))\s*:?\s*([^.;]+)/gi,
    /(?:Schwachstelle|vulnerability|Sicherheitslücke)\s+in\s+([^.;]+)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const product = match[1]?.trim();
      if (product && product.length > 5 && product.length < 200) products.push(product);
    }
  }
  if (products.length > 0) return products.join("; ");

  // Try title
  const titleMatch = title.match(/(?:in|vor|gegen|for)\s+(.+)/i);
  if (titleMatch?.[1]) return titleMatch[1].trim();

  return null;
}

// ---------------------------------------------------------------------------
// Stream: Technical Reports (Fachberichte) → guidance
// ---------------------------------------------------------------------------

async function collectTechnicalReportLinks(): Promise<Array<{ url: string; title: string }>> {
  const links: Array<{ url: string; title: string }> = [];
  const indexUrl = `${BASE}/ncsc/de/home/dokumentation/berichte/fachberichte.html`;
  const $ = await fetchPage(indexUrl);
  await sleep(RATE_LIMIT_MS);
  if (!$) {
    log("  Failed to fetch technical reports index page");
    return links;
  }

  $("a[href*='/fachberichte/']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || !text || text.length < 10) return;
    if (href.endsWith("fachberichte.html")) return; // Skip self-link
    if (href.includes(".pdf")) return; // Skip direct PDF links (we want HTML pages)

    const fullUrl = href.startsWith("http") ? href : `${BASE}${href}`;
    links.push({ url: fullUrl, title: text });
  });

  const seen = new Set<string>();
  return links.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

async function ingestTechnicalReports(db: Database.Database): Promise<number> {
  log("=== Stream: Technical Reports (Fachberichte) ===");
  const links = await collectTechnicalReportLinks();
  log(`Found ${links.length} technical report links`);

  let ingested = 0;
  let skipped = 0;

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO guidance
     (reference, title, title_en, date, type, series, summary, full_text, topics, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const existsStmt = db.prepare("SELECT 1 FROM guidance WHERE reference = ?");

  for (let i = 0; i < links.length; i++) {
    const link = links[i]!;
    const slugMatch = link.url.match(/\/fachberichte\/([\w-]+)\.html$/);
    const slug = slugMatch?.[1] ?? `techreport-${i}`;
    const reference = `NCSC-CH-TR-${slug}`;

    logProgress("tech-reports", i + 1, links.length, reference);

    if (RESUME && existsStmt.get(reference)) {
      skipped++;
      continue;
    }

    // Fetch German page
    const $de = await fetchPage(link.url);
    await sleep(RATE_LIMIT_MS);
    if (!$de) continue;

    const title = extractTitle($de) || link.title;
    const fullText = extractArticleText($de);
    if (fullText.length < 50) continue;

    const date = extractDate($de);
    const summary = buildSummary($de, fullText);

    // Fetch English page for title
    let titleEn: string | null = null;
    const enUrl = link.url.replace("/ncsc/de/", "/ncsc/en/");
    const $en = await fetchPage(enUrl);
    await sleep(RATE_LIMIT_MS);
    if ($en) {
      titleEn = extractTitle($en);
    }

    const topics = JSON.stringify(["Fachbericht", "Cybersicherheit", "NCSC-CH"]);

    if (!DRY_RUN) {
      insertStmt.run(reference, title, titleEn, date, "technical_report", "NCSC-CH", summary, fullText, topics, "current");
    }
    ingested++;
    log(`  + ${reference}: ${title.slice(0, 80)}`);
  }

  log(`Technical reports: ${ingested} ingested, ${skipped} skipped (resume)`);
  return ingested;
}

// ---------------------------------------------------------------------------
// Stream: Situation Reports (Lageberichte) → guidance
// ---------------------------------------------------------------------------

function generateSituationReportUrls(): Array<{ year: number; half: number; urlDe: string; urlEn: string }> {
  const urls: Array<{ year: number; half: number; urlDe: string; urlEn: string }> = [];
  // Semi-annual reports go back to at least 2019
  for (let year = 2019; year <= CURRENT_YEAR; year++) {
    if (YEAR_FILTER && year !== YEAR_FILTER) continue;
    for (const half of [1, 2]) {
      // Skip future reports
      const now = new Date();
      if (year > now.getFullYear()) continue;
      if (year === now.getFullYear() && half === 2 && now.getMonth() < 6) continue;

      urls.push({
        year,
        half,
        urlDe: `${BASE}/ncsc/de/home/dokumentation/berichte/lageberichte/halbjahresbericht-${year}-${half}.html`,
        urlEn: `${BASE}/ncsc/en/home/dokumentation/berichte/lageberichte/halbjahresbericht-${year}-${half}.html`,
      });
    }
  }
  return urls;
}

async function ingestSituationReports(db: Database.Database): Promise<number> {
  log("=== Stream: Situation Reports (Lageberichte) ===");
  const urls = generateSituationReportUrls();
  log(`Checking ${urls.length} possible situation reports`);

  let ingested = 0;
  let skipped = 0;
  let notFound = 0;

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO guidance
     (reference, title, title_en, date, type, series, summary, full_text, topics, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const existsStmt = db.prepare("SELECT 1 FROM guidance WHERE reference = ?");

  for (let i = 0; i < urls.length; i++) {
    const entry = urls[i]!;
    const { year, half, urlDe, urlEn } = entry;
    const reference = `NCSC-CH-HJB-${year}-${half}`;

    logProgress("situation", i + 1, urls.length, reference);

    if (RESUME && existsStmt.get(reference)) {
      skipped++;
      continue;
    }

    const $de = await fetchPage(urlDe);
    await sleep(RATE_LIMIT_MS);
    if (!$de) {
      notFound++;
      continue;
    }

    const title = extractTitle($de);
    if (!title) {
      notFound++;
      continue;
    }
    const fullText = extractArticleText($de);
    if (fullText.length < 50) {
      notFound++;
      continue;
    }

    const date = extractDate($de) || `${year}-${half === 1 ? "06" : "12"}-30`;
    const summary = buildSummary($de, fullText);

    let titleEn: string | null = null;
    const $en = await fetchPage(urlEn);
    await sleep(RATE_LIMIT_MS);
    if ($en) {
      titleEn = extractTitle($en);
    }

    const topics = JSON.stringify(["Lagebericht", "Halbjahresbericht", "Cybersicherheit", "Schweiz", `${year}`]);

    if (!DRY_RUN) {
      insertStmt.run(reference, title, titleEn, date, "situation_report", "NCSC-CH", summary, fullText, topics, "current");
    }
    ingested++;
    log(`  + ${reference}: ${title.slice(0, 80)}`);
  }

  log(`Situation reports: ${ingested} ingested, ${skipped} skipped, ${notFound} not found`);
  return ingested;
}

// ---------------------------------------------------------------------------
// Framework metadata update
// ---------------------------------------------------------------------------

function upsertFrameworks(db: Database.Database): void {
  if (DRY_RUN) return;

  log("=== Updating framework metadata ===");

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO frameworks (id, name, name_en, description, document_count)
     VALUES (?, ?, ?, ?, ?)`,
  );

  // Count guidance by series
  const countStmt = db.prepare("SELECT COUNT(*) as n FROM guidance WHERE series = ?");

  const ncscCount = (countStmt.get("NCSC-CH") as { n: number })?.n ?? 0;
  const isbCount = (countStmt.get("ISB") as { n: number })?.n ?? 0;
  const isgCount = (countStmt.get("ISG") as { n: number })?.n ?? 0;
  const advisoryCount = (db.prepare("SELECT COUNT(*) as n FROM advisories").get() as { n: number })?.n ?? 0;

  insertStmt.run(
    "ncsc-ch",
    "NCSC-CH Warnungen und Empfehlungen",
    "NCSC-CH Warnings and Recommendations",
    "Das BACS (Bundesamt fuer Cybersicherheit, vormals NCSC-CH) veroeffentlicht Wochenrueckblicke, Warnungen, technische Berichte und Lageberichte zu Cyberbedrohungen in der Schweiz. Betreibt GovCERT.ch fuer Bundesbehoerden und kritische Infrastrukturen.",
    ncscCount + advisoryCount,
  );

  insertStmt.run(
    "isb",
    "ISB Bundesstandards IKT (BSTD)",
    "Swiss Federal ICT Standards (BSTD)",
    "Der ISB (Informatiksteuerungsorgan des Bundes) gibt verbindliche IKT-Standards (BSTD) fuer die Bundesverwaltung heraus. Diese regulieren u.a. Datensicherheit, Netzwerksicherheit, Identitaets- und Zugangsverwaltung sowie Business Continuity. Grundlage: RVOG Art. 58 und ISBV.",
    isbCount,
  );

  insertStmt.run(
    "isg",
    "Informationssicherheitsgesetz (ISG)",
    "Swiss Information Security Act (ISG)",
    "Das Bundesgesetz ueber die Informationssicherheit beim Bund (ISG, SR 128) regelt den Schutz von Informationen und Informatikmitteln des Bundes. In Kraft seit 1. Januar 2023. Gilt fuer die Bundesverwaltung, Kantone mit Bundesaufgaben und Betreiber kritischer Infrastrukturen. Schreibt Meldepflicht fuer Cyberangriffe auf kritische Infrastrukturen vor (ab 1. April 2025).",
    isgCount,
  );

  log(`Frameworks updated: NCSC-CH (${ncscCount + advisoryCount}), ISB (${isbCount}), ISG (${isgCount})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("NCSC-CH Ingestion Crawler");
  log(`Database: ${DB_PATH}`);
  log(`Mode: ${DRY_RUN ? "DRY RUN" : RESUME ? "RESUME" : FORCE ? "FORCE (fresh DB)" : "NORMAL"}`);
  if (STREAM_FILTER) log(`Stream filter: ${STREAM_FILTER}`);
  if (YEAR_FILTER) log(`Year filter: ${YEAR_FILTER}`);
  log("");

  const db = openDb();

  const shouldRun = (name: string): boolean => !STREAM_FILTER || STREAM_FILTER === name;

  let totalIngested = 0;

  try {
    if (shouldRun("weekly")) {
      totalIngested += await ingestWeeklyReviews(db);
    }

    if (shouldRun("warnings")) {
      totalIngested += await ingestWarnings(db);
    }

    if (shouldRun("tech-reports")) {
      totalIngested += await ingestTechnicalReports(db);
    }

    if (shouldRun("situation")) {
      totalIngested += await ingestSituationReports(db);
    }

    // Update framework document counts
    upsertFrameworks(db);

    // Final summary
    const gc = (db.prepare("SELECT COUNT(*) as n FROM guidance").get() as { n: number }).n;
    const ac = (db.prepare("SELECT COUNT(*) as n FROM advisories").get() as { n: number }).n;
    const fc = (db.prepare("SELECT COUNT(*) as n FROM frameworks").get() as { n: number }).n;

    log("");
    log("=== Ingestion Complete ===");
    log(`Ingested this run: ${totalIngested}`);
    log(`Database totals: guidance=${gc}, advisories=${ac}, frameworks=${fc}`);
    log(`Elapsed: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\nFATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + "\n");
  process.exit(1);
});
