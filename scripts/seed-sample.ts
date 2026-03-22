/**
 * Seed the NCSC-CH database with sample guidance, advisories, and frameworks.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["NCSC_CH_DB_PATH"] ?? "data/ncsc-ch.db";
const force = process.argv.includes("--force");

const dir = dirname(DB_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
if (force && existsSync(DB_PATH)) { unlinkSync(DB_PATH); console.log(`Deleted ${DB_PATH}`); }

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);
console.log(`Database initialised at ${DB_PATH}`);

interface FrameworkRow { id: string; name: string; name_en: string; description: string; document_count: number; }

const frameworks: FrameworkRow[] = [
  { id: "isb", name: "ISB Bundesstandards IKT (BSTD)", name_en: "Swiss Federal ICT Standards (BSTD)", description: "Der ISB (Informatiksteuerungsorgan des Bundes) gibt verbindliche IKT-Standards (BSTD) für die Bundesverwaltung heraus. Diese regulieren u.a. Datensicherheit, Netzwerksicherheit, Identitäts- und Zugangsverwaltung sowie Business Continuity. Grundlage: RVOG Art. 58 und ISBV.", document_count: 40 },
  { id: "isg", name: "Informationssicherheitsgesetz (ISG)", name_en: "Swiss Information Security Act (ISG)", description: "Das Bundesgesetz über die Informationssicherheit beim Bund (ISG, SR 128) regelt den Schutz von Informationen und Informatikmitteln des Bundes. In Kraft seit 1. Januar 2023. Gilt für die Bundesverwaltung, Kantone mit Bundesaufgaben und Betreiber kritischer Infrastrukturen. Schreibt Meldepflicht für Cyberangriffe auf kritische Infrastrukturen vor.", document_count: 20 },
  { id: "ncsc-ch", name: "NCSC-CH Warnungen und Empfehlungen", name_en: "NCSC-CH Warnings and Recommendations", description: "Das NCSC-CH (Nationales Zentrum für Cybersicherheit / Centre national pour la cybersécurité) veröffentlicht Warnungen, technische Empfehlungen und Berichte zu Cyberbedrohungen in der Schweiz. Betreibt GovCERT.ch für Bundesbehörden und kritische Infrastrukturen.", document_count: 300 },
];

const insertFramework = db.prepare("INSERT OR IGNORE INTO frameworks (id, name, name_en, description, document_count) VALUES (?, ?, ?, ?, ?)");
for (const f of frameworks) insertFramework.run(f.id, f.name, f.name_en, f.description, f.document_count);
console.log(`Inserted ${frameworks.length} frameworks`);

interface GuidanceRow { reference: string; title: string; title_en: string | null; date: string; type: string; series: string; summary: string; full_text: string; topics: string; status: string; }

const guidance: GuidanceRow[] = [
  {
    reference: "ISB-BSTD-2023-01",
    title: "Bundesstandard Datensicherheit — Anforderungen an den Schutz von Bundesinformationen",
    title_en: "Federal Standard Data Security — Requirements for the Protection of Federal Information",
    date: "2023-01-01",
    type: "isb_standard",
    series: "ISB",
    summary: "ISB-Bundesstandard zu Datensicherheitsanforderungen für Bundesstellen. Definiert Schutzbedarfsklassen (normal, erhöht, hoch) und zugehörige Sicherheitsmaßnahmen. Umfasst Verschlüsselungsanforderungen, Zugangskontrolle und Datenklassifikation gemäß ISG.",
    full_text: "ISB-BSTD-2023-01 Datensicherheit Bundesverwaltung. Schutzbedarfsklassen: normal (öffentliche oder intern nutzbare Informationen), erhöht (vertrauliche Informationen mit spürbarem Schaden bei Offenlegung), hoch (sehr vertraulich, erheblicher Schaden). Maßnahmen nach Klasse: Normal — Standardsicherheitsmaßnahmen, Zugang auf berechtigte Personen beschränkt; Erhöht — Zusätzliche Authentifizierung, Verschlüsselung bei Transport, Audit-Logs; Hoch — Starke Authentifizierung (MFA), End-to-End-Verschlüsselung, HSM, physische Sicherheit. Verschlüsselung: AES-256 für Daten im Ruhezustand (Klasse erhöht und hoch); TLS 1.2+ für Datenübertragung; TLS 1.3 empfohlen. Datenklassifikation: Informationen müssen bei Erstellung klassifiziert werden; Klassifikationsmarkierung auf Dokumenten; Deklassifikation nach definierter Frist. Löschung: sichere Löschverfahren (Überschreiben 3x oder kryptographische Löschung); Vernichtung von Datenträgern gemäß VSGV.",
    topics: JSON.stringify(["Datensicherheit", "Klassifikation", "Verschlüsselung", "ISG"]),
    status: "current",
  },
  {
    reference: "ISG-Meldepflicht-2023",
    title: "Meldepflicht für Cyberangriffe auf kritische Infrastrukturen gemäß ISG",
    title_en: "Mandatory Reporting of Cyberattacks on Critical Infrastructures under the ISG",
    date: "2023-10-01",
    type: "isb_standard",
    series: "ISG",
    summary: "Leitfaden zur Meldepflicht für Cyberangriffe auf kritische Infrastrukturen gemäß ISG Art. 74b (in Kraft ab 1. April 2025). Betrifft Betreiber kritischer Infrastrukturen. Meldung an NCSC-CH innerhalb 24 Stunden. Umfasst Meldeprozess, Ausnahmen und Sanktionen.",
    full_text: "ISG Meldepflicht Cyberangriffe. Geltungsbereich ab 1. April 2025: Betreiber kritischer Infrastrukturen (Energie, Trinkwasser, Finanzen, Gesundheit, Verkehr, Telekommunikation, Behörden). Definition meldepflichtiger Vorfall: Cyberangriff mit signifikanter Auswirkung auf kritische Infrastruktur; konkrete Störung des Betriebs; erhebliche Gefahr für Leib und Leben, öffentliche Ordnung oder Sicherheit. Meldefrist: 24 Stunden nach Kenntnisnahme (Erstmeldung); keine Pflicht zur abschließenden Beurteilung. Meldestelle: NCSC-CH (melde.ncsc.admin.ch oder ncsc@gs-efd.admin.ch). Inhalt der Meldung: Zeitpunkt und Art des Angriffs; betroffene Systeme und Dienste; Auswirkungen; bereits ergriffene Maßnahmen. Sanktionen: bis CHF 100.000 Busse bei Verletzung der Meldepflicht (ab 2026). Freiwillige Meldungen: weiterhin möglich und erwünscht via meldeformular.ncsc.admin.ch; keine Sanktionen; NCSC-CH gibt Empfehlungen.",
    topics: JSON.stringify(["Meldepflicht", "ISG", "kritische Infrastruktur", "Cybersicherheit"]),
    status: "current",
  },
  {
    reference: "NCSC-CH-Rec-2024-TLS",
    title: "NCSC-CH Empfehlung: TLS-Sicherheitskonfiguration für Bundesstellen und kritische Infrastrukturen",
    title_en: "NCSC-CH Recommendation: TLS Security Configuration for Federal Bodies and Critical Infrastructure",
    date: "2024-01-15",
    type: "recommendation",
    series: "NCSC-CH",
    summary: "NCSC-CH-Empfehlung zu sicheren TLS-Konfigurationen. TLS 1.3 empfohlen; TLS 1.2 akzeptiert; TLS 1.0/1.1 verboten. Orientiert sich an BSI TR-02102-2 und ENISA-Leitlinien. Gilt für öffentlich erreichbare Dienste und interne Systeme mit erhöhtem Schutzbedarf.",
    full_text: "NCSC-CH TLS-Sicherheitskonfiguration. TLS-Versionen: TLS 1.3 empfohlen; TLS 1.2 akzeptiert mit starken Cipher-Suites; TLS 1.1 abgekündigt (Übergangsfrist bis Ende 2024); TLS 1.0 und SSL verboten. TLS 1.3 Cipher-Suites (alle akzeptiert): TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256, TLS_AES_128_GCM_SHA256. TLS 1.2 Cipher-Suites (nur ECDHE/DHE): ECDHE-ECDSA-AES256-GCM-SHA384, ECDHE-RSA-AES256-GCM-SHA384; RC4, 3DES, NULL, EXPORT-Suites verboten. Zertifikate: RSA minimum 2048 Bit (3072+ für > 3 Jahre Gültigkeit); EC: P-256, P-384 oder P-521; SHA-256+; SAN-Feld korrekt; Gültigkeit max. 398 Tage bei öffentlichen CAs. HSTS: max-age mind. 1 Jahr; includeSubDomains empfohlen; Preloading für behördliche Domains. OCSP Stapling: für öffentliche Dienste. Keine TLS-Kompression (CRIME). nginx Referenzkonfiguration: ssl_protocols TLSv1.2 TLSv1.3; ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384'.",
    topics: JSON.stringify(["TLS", "Konfiguration", "Verschlüsselung", "NCSC-CH"]),
    status: "current",
  },
  {
    reference: "GovCERT-2024-OT-ICS",
    title: "GovCERT.ch: Bedrohungslage OT/ICS in der Schweiz — Lagebericht 2024",
    title_en: "GovCERT.ch: OT/ICS Threat Landscape in Switzerland — Situation Report 2024",
    date: "2024-02-01",
    type: "technical_report",
    series: "NCSC-CH",
    summary: "GovCERT.ch-Lagebericht zur Bedrohungslage für Operational Technology (OT) und Industrial Control Systems (ICS) in der Schweiz. Analyse aktueller Angriffsmuster, Schwachstellen in ICS-Protokollen und Empfehlungen für Betreiber kritischer Infrastrukturen.",
    full_text: "GovCERT.ch OT/ICS Lagebericht 2024. Bedrohungsakteure gegen Schweizer OT: russischsprachige Hacktivisten (NoName057(16)); staatlich gesponserte APTs (Volt Typhoon, Sandworm); cyberkriminelle Gruppen mit OT-Interesse. Angriffsvektoren OT: Internet-exponierte OT-Systeme (Shodan zeigt >1200 exponierte CH-Systeme); Angriff über IT-OT-Grenze; Schwachstellen in Remote-Access-Lösungen; kompromittierte Lieferanten. Häufigste Schwachstellen Schweizer OT-Systeme: veraltete Software (keine Patches); schwache Authentifizierung (Standardpasswörter, kein MFA); fehlende Netzwerktrennung; unsichere Protokolle (Modbus/TCP ohne Auth). Empfehlungen Betreiber kritischer Infrastrukturen: Asset-Inventar OT komplett; IT-OT-Segmentierung mit Data Diodes oder Firewalls; keine direkte Internetverbindung OT; Remote Access nur via VPN mit MFA; OT-spezifisches Monitoring (Claroty, Dragos). Meldepflicht: ab April 2025 meldepflichtig für kritische Infrastrukturen; freiwillige Meldung jetzt über meldeformular.ncsc.admin.ch.",
    topics: JSON.stringify(["OT", "ICS", "kritische Infrastruktur", "Schweiz"]),
    status: "current",
  },
  {
    reference: "ISB-BSTD-IAM-2022",
    title: "Bundesstandard Identitäts- und Zugangsverwaltung (IAM) für Bundesstellen",
    title_en: "Federal Standard Identity and Access Management (IAM) for Federal Bodies",
    date: "2022-07-01",
    type: "isb_standard",
    series: "ISB",
    summary: "ISB-Standard für IAM in Bundesstellen. Definiert Anforderungen zu Benutzeridentitäten, Authentifizierung, Zugriffsrechten und Privileged Access Management (PAM). Zwei-Faktor-Authentifizierung (2FA) für alle externen Zugänge und privilegierten Accounts obligatorisch.",
    full_text: "ISB-BSTD IAM Bundesverwaltung. Benutzeridentitäten: eindeutige, personalisierte Accounts; keine gemeinsam genutzten Accounts; Gastaccounts mit Zeitbeschränkung; regelmäßige Überprüfung (jährlich). Authentifizierung: 2FA obligatorisch für: alle externen Zugänge (Remote Work, VPN); alle privilegierten Accounts (Admin, Root); Zugriff auf Informationen mit erhöhtem/hohem Schutzbedarf. Akzeptierte 2FA-Methoden: Hardware-Token (FIDO2/WebAuthn bevorzugt); Software-Token (TOTP); PKI-Zertifikat; SMS-OTP akzeptiert (nicht empfohlen). Passwortrichtlinien: Minimum 12 Zeichen; Komplexitätsanforderungen; kein Ablauf bei sicherem Passwort (NIST 800-63B); Prüfung gegen kompromittierte Passwortlisten. Privileged Access Management (PAM): separate Admin-Accounts (kein normales Arbeiten mit Admin-Rechten); Just-in-Time-Zugriff für kritische Systeme; PAM-Lösung für Tier-0/1-Systeme; vollständige Audit-Protokollierung. Zugriffsrechte: Least-Privilege; rollenbasiert (RBAC); Genehmigungsprozess; Review alle 6 Monate für privilegierte Rechte.",
    topics: JSON.stringify(["IAM", "MFA", "PAM", "Zugangskontrolle"]),
    status: "current",
  },
  {
    reference: "NCSC-CH-TechRep-2023-Phishing",
    title: "NCSC-CH Bericht: Phishing-Trends in der Schweiz 2023",
    title_en: "NCSC-CH Report: Phishing Trends in Switzerland 2023",
    date: "2023-12-15",
    type: "technical_report",
    series: "NCSC-CH",
    summary: "NCSC-CH-Halbjahresbericht zur Phishing-Lage in der Schweiz (2. Halbjahr 2023). Analyse von 8.000+ gemeldeten Phishing-Vorfällen. Häufigste Themen: Post/Paketdienste (32%), Krypto-Investments (18%), SECO/Staatssekretariat (11%). Empfehlungen für Organisationen und Einzelpersonen.",
    full_text: "NCSC-CH Phishing-Trends Schweiz 2023. Statistik 2. HJ 2023: 8.247 gemeldete Phishing-Fälle (+23% vs. 1. HJ); davon 15% erfolgreich. Häufigste Phishing-Themen: Post/DHL/FedEx Paketbenachrichtigungen (32%); Krypto-Investmentbetrug (18%); Behörden (SECO, ESTV, BIT) (11%); Microsoft/Office 365 Credential Phishing (9%); Bank-Phishing (8%). Techniken: Lookalike-Domains (ch-post.com statt post.ch); Unicode-Homoglyphen; HTTPS überall (kein Sicherheitsmerkmal mehr); QR-Code-Phishing (Quishing) neu; Voice-Phishing (Vishing) mit AI-Stimmen. Schutzmaßnahmen Organisationen: Anti-Phishing-Filter; DMARC Reject-Policy; Mitarbeiterschulung; MFA für alle Accounts; Passwort-Manager. Schutzmaßnahmen Einzelpersonen: URL vor Klick prüfen; kein Eintippen von Passwörtern aus Links; NCSC-CH Meldeplattform nutzen. Vorfälle melden: meldeformular.ncsc.admin.ch (anonym möglich).",
    topics: JSON.stringify(["Phishing", "Social Engineering", "Bewusstsein", "Schweiz"]),
    status: "current",
  },
];

const insertGuidance = db.prepare(`INSERT OR IGNORE INTO guidance (reference, title, title_en, date, type, series, summary, full_text, topics, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const g of guidance) insertGuidance.run(g.reference, g.title, g.title_en, g.date, g.type, g.series, g.summary, g.full_text, g.topics, g.status);
console.log(`Inserted ${guidance.length} guidance documents`);

interface AdvisoryRow { reference: string; title: string; date: string; severity: string; affected_products: string; summary: string; full_text: string; cve_references: string | null; }

const advisories: AdvisoryRow[] = [
  {
    reference: "NCSC-CH-2024-0019",
    title: "Kritische Schwachstelle in Ivanti Connect Secure — Sofortiger Handlungsbedarf",
    date: "2024-01-12",
    severity: "critical",
    affected_products: "Ivanti Connect Secure (alle Versionen vor 9.1R18.3, 22.3R3.2, 22.4R2.4, 22.5R1.3, 22.5R2.4, 22.6R1.3); Ivanti Policy Secure",
    summary: "Das NCSC-CH warnt vor aktiver Ausnutzung von CVE-2023-46805 und CVE-2024-21887 in Ivanti Connect Secure. Kombination erlaubt nicht authentifizierte Remote-Code-Ausführung. Staatlich gesponserte Angreifer (vermutlich chinesischer Ursprung) setzen persistente Webshells ein. Mehrere Schweizer Behörden und kritische Infrastrukturen potenziell betroffen.",
    full_text: "NCSC-CH-2024-0019 Ivanti Connect Secure kritische Schwachstellen. CVE-2023-46805 (CVSS 8.2): Authentication Bypass im Web-Komponent. CVE-2024-21887 (CVSS 9.1): Command Injection für authentifizierte Admins. Kombination: unauthentifiziertes RCE. Angreifer (vermutlich UNC5221, China-Nexus) deployen Webshells (GLASSTOKEN, LIGHTWIRE); Persistenz überlebt Factory Reset durch Manipulation des Update-Prozesses. Betroffene Schweizer Sektoren: Bundesverwaltung; kantonale Verwaltungen; Gesundheitswesen; Finanzsektor; kritische Infrastrukturen. Sofortmaßnahmen: Patches von Ivanti einspielen (seit 22. Januar 2024); Ivanti Integrity Checker Tool ausführen; Logs auf Kompromittierung prüfen (ungewöhnliche Zugriffe auf /api/v1/totp/); Passwörter aller VPN-Nutzer zurücksetzen. Meldung: Kompromittierungen an NCSC-CH melden (ncsc@gs-efd.admin.ch oder meldeformular.ncsc.admin.ch); ab April 2025 Meldepflicht für kritische Infrastrukturen.",
    cve_references: "CVE-2023-46805, CVE-2024-21887",
  },
  {
    reference: "NCSC-CH-2023-0156",
    title: "Ransomware-Angriff auf Schweizer Unternehmen — Warnung vor Play-Ransomware",
    date: "2023-09-20",
    severity: "high",
    affected_products: "Windows Server-Infrastrukturen ohne MFA; Exchange Server ohne aktuelle Patches; Unternehmen ohne Netzwerksegmentierung",
    summary: "Das NCSC-CH warnt vor einer aktiven Kampagne der Play-Ransomware-Gruppe gegen Schweizer Unternehmen und Behörden. Play nutzt Exchange-Schwachstellen und kompromittierte RDP-Zugänge. Mehrere Schweizer KMU und Gemeinden bereits betroffen. Doble Erpressung (Verschlüsselung + Daten-Leak).",
    full_text: "NCSC-CH-2023-0156 Play Ransomware Schweiz. Play Ransomware (auch PlayCrypt): aktive Gruppe seit 2022; doppelte Erpressung; Schweiz überproportional betroffen. Einstiegsvektoren: Exchange Server mit ProxyNotShell (CVE-2022-41082) — Exchange ohne Patch; kompromittierte RDP-Zugänge ohne MFA; gestohlene Credentials aus Infostealer-Malware. Post-Compromise-Techniken: AdFind, BloodHound für AD-Erkundung; Cobalt Strike für C2; Mimikatz/KeeThief für Credentials; WinRAR + MEGASync für Exfiltration; Vollständige AD-Kompromittierung vor Verschlüsselung. Betroffene Sektoren in der Schweiz: Gemeinden (3 bestätigte Fälle 2023); Gesundheitswesen; Industrie. Präventionsmaßnahmen: Exchange Server sofort patchen; MFA für RDP und VPN; Netzwerksegmentierung; Offline-Backups testen. Vorgehen bei Befall: Netzwerk isolieren; NCSC-CH informieren; kantonale Polizei; keine Lösegeldzahlung ohne Rücksprache. Kontakt NCSC-CH: ncsc@gs-efd.admin.ch.",
    cve_references: "CVE-2022-41082, CVE-2022-41040",
  },
  {
    reference: "NCSC-CH-2024-0034",
    title: "ConnectWise ScreenConnect kritische Schwachstelle — Sofortiger Patch erforderlich",
    date: "2024-02-22",
    severity: "critical",
    affected_products: "ConnectWise ScreenConnect vor Version 23.9.8 (alle on-premise Installationen); ConnectWise Control",
    summary: "Das NCSC-CH warnt vor kritischen Schwachstellen (CVE-2024-1709, CVE-2024-1708) in ConnectWise ScreenConnect. CVE-2024-1709 ermöglicht Authentication Bypass mit Sofort-RCE. Aktive Ausnutzung bestätigt. Schweizer MSPs und ihre Kunden besonders gefährdet. Sofortiger Patch auf Version 23.9.8.",
    full_text: "NCSC-CH-2024-0034 ConnectWise ScreenConnect. CVE-2024-1709 (CVSS 10.0 KRITISCH): Authentication Bypass als erste Stufe — vollständige Umgehung der Authentifizierung möglich. CVE-2024-1708 (CVSS 8.4 HOCH): Path Traversal ermöglicht Datei-Upload auf Server. Kombination: vollständig nicht authentifiziertes RCE. CISA: Schwachstelle in KEV (Known Exploited Vulnerabilities) aufgeführt; aktive Ausnutzung durch mehrere Bedrohungsakteure (Ransomware-Gruppen, staatliche Akteure). Schweizer Kontext: ConnectWise ScreenConnect weit verbreitet bei Schweizer MSPs (Managed Service Providers); Kompromittierung eines MSP gefährdet alle betreuten Kunden. Betroffene Versionen: ScreenConnect 23.9.7 und älter (on-premise). Patch: sofort updaten auf 23.9.8 oder neuer; Cloud-Instanzen von ConnectWise automatisch gepatcht. Falls kein sofortiger Patch möglich: Zugang zu ScreenConnect auf bekannte IP-Adressen beschränken; Instanz vom Internet nehmen. Kompromittierung melden: ncsc@gs-efd.admin.ch oder meldeformular.ncsc.admin.ch.",
    cve_references: "CVE-2024-1709, CVE-2024-1708",
  },
];

const insertAdvisory = db.prepare(`INSERT OR IGNORE INTO advisories (reference, title, date, severity, affected_products, summary, full_text, cve_references) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
for (const a of advisories) insertAdvisory.run(a.reference, a.title, a.date, a.severity, a.affected_products, a.summary, a.full_text, a.cve_references);
console.log(`Inserted ${advisories.length} advisories`);

const gc = (db.prepare("SELECT COUNT(*) as n FROM guidance").get() as { n: number }).n;
const ac = (db.prepare("SELECT COUNT(*) as n FROM advisories").get() as { n: number }).n;
const fc = (db.prepare("SELECT COUNT(*) as n FROM frameworks").get() as { n: number }).n;
console.log(`\nDatabase summary:\n  Guidance: ${gc}\n  Advisories: ${ac}\n  Frameworks: ${fc}\n\nSeed complete.`);
