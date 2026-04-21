const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 3001;

// --- GCS write-through persistence -----------------------------------------
// Opt-in: set GCS_BUCKET to enable. Without it, server runs with local-only files.
// On startup, hydrate local files from GCS. On each save, debounce-upload to GCS.
const GCS_BUCKET = process.env.GCS_BUCKET;
const GCS_PREFIX = process.env.GCS_PREFIX || "dragonfly/";
const UPLOAD_DEBOUNCE_MS = 2000;

let gcsBucket = null;
if (GCS_BUCKET) {
  try {
    const { Storage } = require("@google-cloud/storage");
    gcsBucket = new Storage().bucket(GCS_BUCKET);
    console.log(`GCS persistence: gs://${GCS_BUCKET}/${GCS_PREFIX}`);
  } catch (err) {
    console.error("GCS init failed, continuing with local-only:", err.message);
    gcsBucket = null;
  }
}

const pendingUploadTimers = new Map(); // fileName -> setTimeout id
const pendingUploadData = new Map();   // fileName -> latest JSON string

async function gcsDownload(fileName) {
  if (!gcsBucket) return null;
  try {
    const obj = gcsBucket.file(GCS_PREFIX + fileName);
    const [exists] = await obj.exists();
    if (!exists) return null;
    const [buf] = await obj.download();
    return buf.toString("utf-8");
  } catch (err) {
    console.error(`GCS download ${fileName} failed:`, err.message);
    return null;
  }
}

async function gcsUpload(fileName, data) {
  if (!gcsBucket) return;
  try {
    await gcsBucket.file(GCS_PREFIX + fileName).save(data, {
      contentType: "application/json",
      metadata: { cacheControl: "no-cache" },
    });
  } catch (err) {
    console.error(`GCS upload ${fileName} failed:`, err.message);
  }
}

function scheduleUpload(fileName, data) {
  if (!gcsBucket) return;
  pendingUploadData.set(fileName, data);
  if (pendingUploadTimers.has(fileName)) clearTimeout(pendingUploadTimers.get(fileName));
  const timer = setTimeout(async () => {
    pendingUploadTimers.delete(fileName);
    const latest = pendingUploadData.get(fileName);
    pendingUploadData.delete(fileName);
    await gcsUpload(fileName, latest);
  }, UPLOAD_DEBOUNCE_MS);
  pendingUploadTimers.set(fileName, timer);
}

async function flushPendingUploads() {
  for (const timer of pendingUploadTimers.values()) clearTimeout(timer);
  const entries = Array.from(pendingUploadData.entries());
  pendingUploadTimers.clear();
  pendingUploadData.clear();
  await Promise.all(entries.map(([name, data]) => gcsUpload(name, data)));
}

async function hydrateFromGCS(fileName, localPath) {
  if (!gcsBucket) return;
  const remote = await gcsDownload(fileName);
  if (!remote) return;
  try {
    JSON.parse(remote);
    if (!fs.existsSync(path.dirname(localPath))) fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, remote, "utf-8");
    console.log(`Hydrated ${fileName} from GCS (${remote.length} bytes)`);
  } catch (err) {
    console.error(`Invalid JSON in GCS ${fileName}, keeping local copy:`, err.message);
  }
}

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, flushing pending GCS uploads...");
  try { await flushPendingUploads(); } catch (e) { console.error("Flush error:", e.message); }
  process.exit(0);
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve static frontend build in production
app.use(express.static(path.join(__dirname, "dist")));

// --- Admin static files ------------------------------------------------------
app.use("/admin", express.static(path.join(__dirname, "public")));

// --- In-memory tracking ------------------------------------------------------
const serverStartTime = Date.now();
let scanCount = 0;
const recentScans = []; // last 50
const activityLog = []; // last 100 activity entries

function logActivity(type, detail) {
  activityLog.unshift({ type, detail, timestamp: new Date().toISOString() });
  if (activityLog.length > 100) activityLog.length = 100;
}

// --- Products persistence ----------------------------------------------------
const DATA_DIR = path.join(__dirname, "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");

function loadProducts() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(PRODUCTS_FILE)) {
      const raw = fs.readFileSync(PRODUCTS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("Error loading products.json:", err.message);
  }
  return { strains: {} };
}

function saveProducts(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(PRODUCTS_FILE, json, "utf-8");
    scheduleUpload(path.basename(PRODUCTS_FILE), json);
  } catch (err) {
    console.error("Error saving products.json:", err.message);
  }
}

let productsDB = loadProducts();

// --- Loyalty storage ---------------------------------------------------------
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const RECEIPTS_FILE = path.join(DATA_DIR, "receipts.json");

function loadJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    console.error(`Error loading ${file}:`, err.message);
  }
  return fallback;
}
function saveJsonFile(file, data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(file, json, "utf-8");
    scheduleUpload(path.basename(file), json);
  } catch (err) {
    console.error(`Error saving ${file}:`, err.message);
  }
}

let accountsDB = loadJsonFile(ACCOUNTS_FILE, {});
let receiptsDB = loadJsonFile(RECEIPTS_FILE, []);

function saveAccounts() { saveJsonFile(ACCOUNTS_FILE, accountsDB); }
function saveReceipts() { saveJsonFile(RECEIPTS_FILE, receiptsDB); }

const normEmail = (e) => String(e || "").trim().toLowerCase();
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// --- Session token (HMAC-signed) --------------------------------------------
function loyaltySecret() {
  return process.env.LOYALTY_SECRET || process.env.ADMIN_KEY || "dev-loyalty-secret-change-me";
}
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString();
}
function signToken(email, ttlMs = 30 * 24 * 3600 * 1000) {
  const payload = { email: normEmail(email), exp: Date.now() + ttlMs };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", loyaltySecret()).update(body).digest("hex");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", loyaltySecret()).update(body).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body));
    if (!payload.email || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}
function requireLoyaltyAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token || "");
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired session. Please verify your email again." });
  req.loyaltyEmail = payload.email;
  next();
}

function receiptHash(retailer, date, total, items) {
  const normItems = (items || []).map(i => `${(i.name || "").toLowerCase().replace(/\s+/g, " ").trim()}|${i.price || 0}|${i.qty || 1}`).sort().join(";");
  const raw = `${(retailer || "").toLowerCase().trim()}|${(date || "").trim()}|${Number(total || 0).toFixed(2)}|${normItems}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// --- Admin auth middleware ----------------------------------------------------
function requireAdmin(req, res, next) {
  const key = req.query.key;
  if (!process.env.ADMIN_KEY) {
    return res.status(500).json({ error: "ADMIN_KEY not configured on server." });
  }
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// --- Retailers data ---------------------------------------------------------
const RETAILERS_FILE = path.join(DATA_DIR, "retailers.json");
let retailers = [];
try { retailers = JSON.parse(fs.readFileSync(RETAILERS_FILE, "utf-8")); } catch (e) {}

app.get("/api/retailers", (req, res) => {
  res.json(retailers);
});

// --- Claude Vision API Proxy ----------------------------------------------
// Keeps the Anthropic API key server-side. Frontend POSTs image to /api/scan,
// server forwards to Claude, returns the strain name.
// Set ANTHROPIC_API_KEY as a Cloud Run environment variable.

app.post("/api/scan", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server." });
  }

  const { image_base64, media_type } = req.body;
  if (!image_base64) {
    return res.status(400).json({ error: "image_base64 is required." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: media_type || "image/jpeg", data: image_base64 }
            },
            {
              type: "text",
              text: `You are the Dragonfly cannabis brand scanner. Look at this image and respond with JSON.

HOW TO IDENTIFY DRAGONFLY PRODUCTS:
Dragonfly products have these distinctive visual features — look for ANY of them:
- RED packaging/tubes/containers (bright red is the signature Dragonfly color)
- GOLD/YELLOW text saying "DRAGONFLY" or the word "DRAGONFLY" anywhere
- A gold DRAGONFLY LOGO/EMBLEM (stylized dragonfly insect with wings)
- The text "dragonflybrandny.com" or "Dragonfly Brand"
- Red tubes with gold and black text
- Product types printed in gold: PREROLL, FLOWER, DISPOSABLE, VAPE, etc.
- Cannabis warning labels from New York state

IMPORTANT: If you see RED packaging with gold text, a dragonfly logo, or the word "DRAGONFLY" anywhere on the product — it IS a Dragonfly product. Set is_dragonfly to true. Even if the brand text is hard to read, the red+gold color scheme with a dragonfly emblem = Dragonfly brand.

OCR the label and extract: strain name, product type, THC%, brand, weight.
If this is NOT a cannabis product at all (food, drink, random object): still identify what it is.

THC READING RULES:
- Vapes/disposables: THC is 80-95%. Use the HIGHEST %. If you see "851 mg/g" that = 85.1%.
- mg/g to %: divide by 10
- Flower/prerolls: THC is 15-35%

Write a short witty one-liner ("roast") as a sarcastic budtender who loves Dragonfly. Be funny, reference what you see.
- Non-cannabis: joke about them scanning random stuff
- Competitor weed: playful shade, suggest Dragonfly is better
- Dragonfly product: genuine compliment
- Inappropriate/NSFW/weird stuff: threaten to send it to their mom. Examples: "Bold move scanning that. Should I forward this to your mom or...?" or "Screenshot saved. Your mother will hear about this." Keep it PG-rated sarcasm, don't describe what you see.

Respond ONLY with valid JSON:
{"strain": "strain/flavor name from label", "product_type": "product type from label", "thc": "THC% or null", "brand": "brand name or null", "weight": "net weight or null", "all_text": "other text on label", "is_cannabis": true/false, "is_dragonfly": true/false, "roast": "your witty one-liner"}`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return res.status(502).json({ error: "Vision API request failed", status: response.status });
    }

    const result = await response.json();
    const rawText = result.content?.[0]?.text?.trim() || "";
    console.log(`Vision raw response: "${rawText}"`);

    // Parse JSON response from Claude
    let strain = "UNKNOWN";
    let product_type = "UNKNOWN";
    let thc = null;
    let confidence = "low";
    let raw_ocr = rawText;

    let brand = "";
    let roast = "";
    let is_cannabis = true;
    let is_dragonfly = false;
    let all_text = "";

    try {
      let jsonStr = rawText;
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.split("\n").slice(1).join("\n").replace(/```\s*$/, "").trim();
      }
      const parsed = JSON.parse(jsonStr);
      strain = parsed.strain || "UNKNOWN";
      product_type = parsed.product_type || "UNKNOWN";
      thc = parsed.thc || null;
      confidence = parsed.confidence || "medium";
      brand = parsed.brand || "";
      roast = parsed.roast || "";
      is_cannabis = parsed.is_cannabis !== false;
      is_dragonfly = parsed.is_dragonfly === true;
      all_text = parsed.all_text || "";
      raw_ocr = null;
    } catch (e) {
      strain = rawText.replace(/["\n]/g, "").trim() || "UNKNOWN";
    }

    console.log(`Vision scan: strain="${strain}", product_type="${product_type}", brand="${brand}", roast="${roast}"`);

    // Track scan
    scanCount++;
    recentScans.unshift({ strain, product_type, timestamp: new Date().toISOString() });
    if (recentScans.length > 50) recentScans.length = 50;
    logActivity("scan", `Scanned: ${strain} (${product_type}) [${brand || "unknown brand"}]`);

    res.json({ strain, product_type, thc, confidence, brand, roast, is_cannabis, is_dragonfly, all_text, raw_ocr });
  } catch (err) {
    console.error("Vision proxy error:", err.message);
    res.status(500).json({ error: "Vision scan failed: " + err.message });
  }
});

// --- Email Configuration ---------------------------------------------------
// Set these as Cloud Run environment variables:
//   RESEND_API_KEY=re_xxxxxxxx (from resend.com)
//   NOTIFY_EMAIL=sasha@dopestr.com
//   FROM_EMAIL=dragonfly@cannacrypted.com

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "sasha@dopestr.com";
const FROM_EMAIL = process.env.FROM_EMAIL || "dragonfly@cannacrypted.com";

// --- In-memory signup log (persists until server restart) ------------------
const signups = [];

// --- Signup Endpoint -------------------------------------------------------
app.post("/api/signup", async (req, res) => {
  const { name, email, phone, strain } = req.body;

  // Validation
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }

  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Store in memory
  const entry = { name, email, phone: phone || "Not provided", strain: strain || "None", timestamp };
  signups.push(entry);
  logActivity("signup", `New signup: ${name} <${email}>`);

  // Build email
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0a0a0a; padding: 32px; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #c8ff00; font-size: 24px; margin: 0; letter-spacing: 2px;">DRAGONFLY</h1>
          <p style="color: #888; font-size: 13px; margin: 4px 0 0;">New Scanner Signup</p>
        </div>
        <div style="background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px; margin-bottom: 16px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top; width: 100px;">Name</td>
              <td style="color: #fff; font-size: 15px; padding: 8px 0; font-weight: 600;">${name}</td>
            </tr>
            <tr>
              <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top;">Email</td>
              <td style="color: #fff; font-size: 15px; padding: 8px 0;"><a href="mailto:${email}" style="color: #c8ff00; text-decoration: none;">${email}</a></td>
            </tr>
            <tr>
              <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top;">Phone</td>
              <td style="color: #fff; font-size: 15px; padding: 8px 0;">${phone || "Not provided"}</td>
            </tr>
            ${strain ? `
            <tr>
              <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top;">Strain</td>
              <td style="color: #fff; font-size: 15px; padding: 8px 0;">${strain} (was viewing when signed up)</td>
            </tr>` : ""}
            <tr>
              <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top;">Time</td>
              <td style="color: #fff; font-size: 15px; padding: 8px 0;">${timestamp}</td>
            </tr>
          </table>
        </div>
        <div style="text-align: center; color: #555; font-size: 11px; margin-top: 16px;">
          Dragonfly Product Scanner - Signup #${signups.length}
        </div>
      </div>
    </div>
  `;

  const textBody = `
DRAGONFLY -- New Scanner Signup
-------------------------------
Name:    ${name}
Email:   ${email}
Phone:   ${phone || "Not provided"}
Strain:  ${strain || "None"}
Time:    ${timestamp}
Signup #${signups.length}
  `.trim();

  // Send email
  try {
    if (process.env.RESEND_API_KEY) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: `"Dragonfly Scanner" <${FROM_EMAIL}>`,
          to: NOTIFY_EMAIL,
          subject: `New Signup: ${name} -- Dragonfly Scanner`,
          text: textBody,
          html: htmlBody
        })
      });
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        throw new Error(`Resend API error ${emailRes.status}: ${errText}`);
      }
      console.log(`Email sent to ${NOTIFY_EMAIL} for signup: ${name} <${email}>`);
    } else {
      console.log(`Resend not configured -- signup logged but email not sent.`);
      console.log(`  To enable emails, set RESEND_API_KEY env var.`);
    }

    // Always log to console as backup
    console.log(`Signup #${signups.length}: ${name} | ${email} | ${phone || "no phone"} | Strain: ${strain || "none"} | ${timestamp}`);

    return res.json({
      success: true,
      message: "Signup received! You'll hear from us soon.",
    });
  } catch (err) {
    console.error("Email send error:", err.message);

    // Still save the signup even if email fails
    console.log(`Signup #${signups.length} (email failed): ${name} | ${email} | ${phone || "no phone"}`);

    return res.json({
      success: true,
      message: "Signup received! You'll hear from us soon.",
      emailWarning: "Notification email could not be sent -- signup was still recorded.",
    });
  }
});

// --- View all signups (internal/admin) -------------------------------------
app.get("/api/signups", (req, res) => {
  const key = req.query.key;
  // Simple auth -- set ADMIN_KEY env var on Cloud Run
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ total: signups.length, signups });
});

// --- Loyalty: Sign in (email-as-identity, no verification) ----------------
app.post("/api/loyalty/signin", (req, res) => {
  const email = normEmail(req.body?.email);
  const name = String(req.body?.name || "").trim().slice(0, 80);

  if (!isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  if (accountsDB[email]?.status === "blocked") return res.status(403).json({ error: "This account is blocked. Contact support." });

  const now = new Date().toISOString();
  if (!accountsDB[email]) {
    accountsDB[email] = { email, name: name || "", points: 0, createdAt: now, lastActivityAt: now, flagCount: 0, status: "active" };
    logActivity("loyalty_signup", `New loyalty account: ${email}`);
  } else {
    if (name && !accountsDB[email].name) accountsDB[email].name = name;
    accountsDB[email].lastActivityAt = now;
  }
  saveAccounts();

  const token = signToken(email);
  const acct = accountsDB[email];
  res.json({ success: true, token, account: { email: acct.email, name: acct.name, points: acct.points } });
});

// --- Loyalty: Get account info + receipt history ---------------------------
app.get("/api/loyalty/account", requireLoyaltyAuth, (req, res) => {
  const email = req.loyaltyEmail;
  const acct = accountsDB[email];
  if (!acct) return res.status(404).json({ error: "Account not found." });
  const myReceipts = receiptsDB.filter(r => r.email === email).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 50);
  res.json({
    account: { email: acct.email, name: acct.name, points: acct.points, createdAt: acct.createdAt, status: acct.status },
    receipts: myReceipts.map(r => ({
      id: r.id, retailer: r.retailer, date: r.date, total: r.total, dragonflySubtotal: r.dragonflySubtotal,
      pointsAwarded: r.pointsAwarded, items: r.items, status: r.status, flags: r.flags, timestamp: r.timestamp,
    })),
  });
});

// --- Loyalty: Update account name ------------------------------------------
app.post("/api/loyalty/update-name", requireLoyaltyAuth, (req, res) => {
  const email = req.loyaltyEmail;
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!accountsDB[email]) return res.status(404).json({ error: "Account not found." });
  accountsDB[email].name = name;
  saveAccounts();
  res.json({ success: true });
});

// --- Loyalty: Scan receipt, extract items, award points --------------------
app.post("/api/loyalty/scan-receipt", requireLoyaltyAuth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server." });

  const email = req.loyaltyEmail;
  const acct = accountsDB[email];
  if (!acct) return res.status(404).json({ error: "Account not found." });
  if (acct.status === "blocked") return res.status(403).json({ error: "This account is blocked. Contact support." });

  const { image_base64, media_type, location } = req.body || {};
  if (!image_base64) return res.status(400).json({ error: "image_base64 is required." });

  // Rapid-submission flag: count receipts from this email in last 5 min
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentCount = receiptsDB.filter(r => r.email === email && new Date(r.timestamp).getTime() > fiveMinAgo).length;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image_base64 } },
            { type: "text", text: `You are a receipt parser for the Dragonfly cannabis brand loyalty program. OCR this receipt image and extract structured data.

IDENTIFY DRAGONFLY ITEMS:
Line items are "Dragonfly" if the product name/brand contains "Dragonfly" OR matches known Dragonfly products. Dragonfly product names include: Honey Banana, Ice Cream Cookies, Jelly Donutz, Orange Creampop, Skeeter, plus generic types (preroll, flower, vape, disposable, infused) when sold under the Dragonfly brand. When uncertain, set is_dragonfly=false.

RETURN ONLY VALID JSON in this exact shape:
{
  "is_receipt": true/false,
  "retailer": "dispensary/store name on receipt, or null",
  "date": "YYYY-MM-DD if you can read it, else null",
  "total": number (grand total in dollars, e.g. 45.99),
  "subtotal": number or null,
  "tax": number or null,
  "currency": "USD",
  "items": [
    { "name": "item name as printed", "qty": number (default 1), "price": number (line total in dollars), "is_dragonfly": true/false, "notes": "short reason if uncertain" }
  ],
  "confidence": "high" | "medium" | "low",
  "parse_notes": "short note if anything was unreadable"
}

RULES:
- "price" per line is the line total (qty * unit), as printed.
- Ignore tax/fee lines in items[] — only product lines.
- If the image is not a receipt (product label, random photo, etc.), set is_receipt=false and leave other fields empty/null.
- Never invent items. Only include lines you can read clearly.
- Respond with JSON only. No prose, no code fences.` }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic receipt parse error:", response.status, errText);
      return res.status(502).json({ error: "Receipt parse failed. Try a clearer photo." });
    }

    const result = await response.json();
    const rawText = result.content?.[0]?.text?.trim() || "";
    let parsed = null;
    try {
      let jsonStr = rawText;
      if (jsonStr.startsWith("```")) jsonStr = jsonStr.split("\n").slice(1).join("\n").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Could not parse receipt JSON:", rawText.slice(0, 500));
      return res.status(422).json({ error: "Could not read receipt. Try a clearer, well-lit photo.", raw: rawText.slice(0, 300) });
    }

    if (!parsed || parsed.is_receipt === false) {
      return res.status(422).json({ error: "That doesn't look like a receipt. Try again with a clearer shot of the full receipt." });
    }

    const retailer = (parsed.retailer || "Unknown Retailer").toString().trim().slice(0, 120);
    const date = (parsed.date || new Date().toISOString().slice(0, 10)).toString().trim().slice(0, 20);
    const total = Number(parsed.total) || 0;
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items = rawItems.map(it => ({
      name: String(it?.name || "").trim().slice(0, 160),
      qty: Number(it?.qty) > 0 ? Number(it.qty) : 1,
      price: Number(it?.price) || 0,
      is_dragonfly: it?.is_dragonfly === true,
      notes: String(it?.notes || "").slice(0, 200),
    })).filter(i => i.name);

    const dragonflySubtotal = items.filter(i => i.is_dragonfly).reduce((sum, i) => sum + (i.price || 0), 0);
    const pointsAwarded = Math.floor(dragonflySubtotal);

    const hash = receiptHash(retailer, date, total, items);
    const duplicate = receiptsDB.find(r => r.hash === hash);
    if (duplicate) {
      logActivity("loyalty_duplicate", `Duplicate receipt blocked for ${email} (hash ${hash.slice(0, 8)})`);
      return res.status(409).json({
        error: "This receipt has already been submitted.",
        duplicate: { email: duplicate.email === email ? "you" : "another account", timestamp: duplicate.timestamp, pointsAwarded: duplicate.pointsAwarded },
      });
    }

    // Anomaly flags (non-blocking)
    const flags = [];
    if (parsed.confidence === "low") flags.push("low_confidence_parse");
    if (items.length === 0) flags.push("no_items_parsed");
    if (dragonflySubtotal === 0) flags.push("no_dragonfly_items");
    if (total > 500) flags.push("high_value");
    if (recentCount >= 3) flags.push("rapid_submission");
    if (dragonflySubtotal > total + 0.01) flags.push("dragonfly_exceeds_total");

    let loc = null;
    if (location && typeof location === "object" && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
      loc = {
        lat: Number(location.lat),
        lng: Number(location.lng),
        accuracy: Number.isFinite(location.accuracy) ? Number(location.accuracy) : null,
        source: String(location.source || "browser").slice(0, 20),
      };
      if (loc.accuracy && loc.accuracy > 1000) flags.push("low_location_accuracy");
    }

    // High submission velocity at account level
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const last24h = receiptsDB.filter(r => r.email === email && new Date(r.timestamp).getTime() > dayAgo).length;
    if (last24h >= 10) flags.push("high_daily_submissions");

    const receipt = {
      id: crypto.randomBytes(8).toString("hex"),
      email,
      retailer, date, total, subtotal: Number(parsed.subtotal) || null, tax: Number(parsed.tax) || null,
      items, dragonflySubtotal,
      pointsAwarded, status: "approved", flags, hash,
      confidence: parsed.confidence || "medium",
      parseNotes: String(parsed.parse_notes || "").slice(0, 300),
      location: loc,
      timestamp: new Date().toISOString(),
    };
    receiptsDB.unshift(receipt);
    if (receiptsDB.length > 5000) receiptsDB.length = 5000;
    saveReceipts();

    acct.points = (acct.points || 0) + pointsAwarded;
    acct.lastActivityAt = receipt.timestamp;
    if (flags.length) acct.flagCount = (acct.flagCount || 0) + 1;
    saveAccounts();

    const detail = `${email} +${pointsAwarded}pts from ${retailer} ($${total.toFixed(2)}, $${dragonflySubtotal.toFixed(2)} Dragonfly)${flags.length ? ` [flags: ${flags.join(",")}]` : ""}`;
    logActivity(flags.length ? "loyalty_receipt_flagged" : "loyalty_receipt", detail);

    res.json({
      success: true,
      receipt: {
        id: receipt.id, retailer, date, total, items, dragonflySubtotal,
        pointsAwarded, flags, confidence: receipt.confidence, parseNotes: receipt.parseNotes, timestamp: receipt.timestamp,
      },
      account: { email: acct.email, name: acct.name, points: acct.points },
    });
  } catch (err) {
    console.error("Receipt scan error:", err.message);
    res.status(500).json({ error: "Receipt scan failed: " + err.message });
  }
});

// --- Health check ----------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    signups: signups.length,
    resendConfigured: !!process.env.RESEND_API_KEY,
    loyaltyAccounts: Object.keys(accountsDB).length,
    loyaltyReceipts: receiptsDB.length,
  });
});

// --- Admin API Endpoints ---------------------------------------------------

// Stats
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const uptimeSec = Math.floor((Date.now() - serverStartTime) / 1000);
  const hours = Math.floor(uptimeSec / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const secs = uptimeSec % 60;

  const loyaltyAccounts = Object.values(accountsDB);
  const pointsIssued = loyaltyAccounts.reduce((sum, a) => sum + (a.points || 0), 0);
  const flaggedCount = receiptsDB.filter(r => r.flags?.length && r.status === "approved").length;

  res.json({
    scanCount,
    signupCount: signups.length,
    productCount: Object.keys(productsDB.strains || {}).length,
    uptime: `${hours}h ${mins}m ${secs}s`,
    uptimeSeconds: uptimeSec,
    recentScans: recentScans.slice(0, 20),
    recentActivity: activityLog.slice(0, 30),
    signups: signups.slice(-20).reverse(),
    loyaltyAccountCount: loyaltyAccounts.length,
    loyaltyReceiptCount: receiptsDB.length,
    loyaltyPointsIssued: pointsIssued,
    loyaltyFlaggedCount: flaggedCount,
  });
});

// --- Admin Loyalty endpoints ----------------------------------------------
app.get("/api/admin/loyalty", requireAdmin, (req, res) => {
  const accounts = Object.values(accountsDB).sort((a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || ""));
  const receipts = receiptsDB.slice(0, 500);
  const pointsIssued = accounts.reduce((s, a) => s + (a.points || 0), 0);
  const flagged = receiptsDB.filter(r => r.flags?.length);
  res.json({
    totals: {
      accounts: accounts.length,
      receipts: receiptsDB.length,
      pointsIssued,
      flaggedReceipts: flagged.length,
      approvedReceipts: receiptsDB.filter(r => r.status === "approved").length,
      voidedReceipts: receiptsDB.filter(r => r.status === "voided").length,
    },
    accounts,
    receipts,
    flagged: flagged.slice(0, 200),
  });
});

// Void a receipt (deducts points from account)
app.post("/api/admin/loyalty/receipts/:id/void", requireAdmin, (req, res) => {
  const id = req.params.id;
  const r = receiptsDB.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: "Receipt not found." });
  if (r.status === "voided") return res.json({ success: true, receipt: r });
  const acct = accountsDB[r.email];
  if (acct) {
    acct.points = Math.max(0, (acct.points || 0) - (r.pointsAwarded || 0));
    saveAccounts();
  }
  r.status = "voided";
  r.voidedAt = new Date().toISOString();
  r.voidReason = String(req.body?.reason || "").slice(0, 200);
  saveReceipts();
  logActivity("loyalty_void", `Voided receipt ${id} for ${r.email} (-${r.pointsAwarded}pts)${r.voidReason ? `: ${r.voidReason}` : ""}`);
  res.json({ success: true, receipt: r, account: acct ? { email: acct.email, points: acct.points } : null });
});

// Flag a receipt manually
app.post("/api/admin/loyalty/receipts/:id/flag", requireAdmin, (req, res) => {
  const id = req.params.id;
  const r = receiptsDB.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: "Receipt not found." });
  const flag = String(req.body?.flag || "manual_review").slice(0, 40);
  r.flags = r.flags || [];
  if (!r.flags.includes(flag)) r.flags.push(flag);
  saveReceipts();
  logActivity("loyalty_flag", `Flagged receipt ${id} (${flag})`);
  res.json({ success: true, receipt: r });
});

// Adjust an account's points (add/remove)
app.post("/api/admin/loyalty/accounts/:email/adjust", requireAdmin, (req, res) => {
  const email = normEmail(req.params.email);
  const acct = accountsDB[email];
  if (!acct) return res.status(404).json({ error: "Account not found." });
  const delta = Math.round(Number(req.body?.delta) || 0);
  const reason = String(req.body?.reason || "").slice(0, 200);
  acct.points = Math.max(0, (acct.points || 0) + delta);
  saveAccounts();
  logActivity("loyalty_adjust", `Adjusted ${email} by ${delta >= 0 ? "+" : ""}${delta}pts${reason ? `: ${reason}` : ""}`);
  res.json({ success: true, account: acct });
});

// Block / unblock an account
app.post("/api/admin/loyalty/accounts/:email/status", requireAdmin, (req, res) => {
  const email = normEmail(req.params.email);
  const acct = accountsDB[email];
  if (!acct) return res.status(404).json({ error: "Account not found." });
  const status = req.body?.status === "blocked" ? "blocked" : "active";
  acct.status = status;
  saveAccounts();
  logActivity("loyalty_status", `Account ${email} -> ${status}`);
  res.json({ success: true, account: acct });
});

// Get all products
app.get("/api/admin/products", requireAdmin, (req, res) => {
  res.json(productsDB);
});

// Update a product
app.put("/api/admin/products/:name", requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!productsDB.strains[name]) {
    return res.status(404).json({ error: `Product "${name}" not found.` });
  }
  productsDB.strains[name] = { ...productsDB.strains[name], ...req.body };
  saveProducts(productsDB);
  logActivity("product_update", `Updated product: ${name}`);
  res.json({ success: true, product: productsDB.strains[name] });
});

// Add a product
app.post("/api/admin/products", requireAdmin, (req, res) => {
  const { name, ...fields } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Product name is required." });
  }
  if (productsDB.strains[name]) {
    return res.status(409).json({ error: `Product "${name}" already exists.` });
  }
  productsDB.strains[name] = fields;
  saveProducts(productsDB);
  logActivity("product_add", `Added product: ${name}`);
  res.json({ success: true, product: productsDB.strains[name] });
});

// Delete a product
app.delete("/api/admin/products/:name", requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!productsDB.strains[name]) {
    return res.status(404).json({ error: `Product "${name}" not found.` });
  }
  delete productsDB.strains[name];
  saveProducts(productsDB);
  logActivity("product_delete", `Deleted product: ${name}`);
  res.json({ success: true });
});

// Scrape dragonflybrandny.com
// Saved scrape sites
const SCRAPE_SITES_FILE = path.join(DATA_DIR, "scrape-sites.json");
function loadScrapeSites() {
  try {
    if (fs.existsSync(SCRAPE_SITES_FILE)) return JSON.parse(fs.readFileSync(SCRAPE_SITES_FILE, "utf-8"));
  } catch (e) {}
  return [{ name: "Dragonfly Collection", url: "https://dragonflybrandny.com/#Our-Collection" }];
}
function saveScrapeSites(sites) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const json = JSON.stringify(sites, null, 2);
    fs.writeFileSync(SCRAPE_SITES_FILE, json, "utf-8");
    scheduleUpload(path.basename(SCRAPE_SITES_FILE), json);
  } catch (e) {}
}
let scrapeSites = loadScrapeSites();

app.get("/api/admin/scrape-sites", requireAdmin, (req, res) => {
  res.json(scrapeSites);
});

app.post("/api/admin/scrape-sites", requireAdmin, (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: "name and url required" });
  scrapeSites.push({ name, url });
  saveScrapeSites(scrapeSites);
  res.json({ success: true, sites: scrapeSites });
});

app.delete("/api/admin/scrape-sites/:index", requireAdmin, (req, res) => {
  const idx = parseInt(req.params.index);
  if (idx >= 0 && idx < scrapeSites.length) {
    scrapeSites.splice(idx, 1);
    saveScrapeSites(scrapeSites);
  }
  res.json({ success: true, sites: scrapeSites });
});

app.post("/api/admin/scrape", requireAdmin, async (req, res) => {
  try {
    const startUrl = (req.body.url || "https://dragonflybrandny.com/").trim();
    logActivity("scrape", `Scrape initiated: ${startUrl}`);

    const headers = { "User-Agent": "Mozilla/5.0 (compatible; DragonflyAdmin/1.0)" };

    // Fetch the main page
    const response = await fetch(startUrl, { headers });
    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch page: ${response.status}` });
    }
    const html = await response.text();

    // Extract base domain for link matching
    const urlObj = new URL(startUrl);
    const baseDomain = urlObj.hostname;

    const discovered = [];
    const discoveredImages = [];
    let match;
    const seenSlugs = new Set();

    // --- Find all product/collection links on the page ---
    const linkRegex = /href="(https?:\/\/[^"]*\/product\/([^/"]+)\/?[^"]*)"/gi;
    const productUrls = [];
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      const slug = match[2];
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      productUrls.push({ url, slug });
      const name = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      discovered.push({ name, slug, url, images: [], price: null, description: "" });
    }

    // --- Also find collection/category links to follow ---
    const collectionRegex = /href="(https?:\/\/[^"]*\/(product-category|shop|collection|category)\/[^"]+)"/gi;
    const collectionUrls = [];
    while ((match = collectionRegex.exec(html)) !== null) {
      collectionUrls.push(match[1]);
    }

    // --- Extract images from main page ---
    const imgRegex = /src="(https?:\/\/[^"]+\/wp-content\/uploads\/[^"]+\.(webp|jpg|png|jpeg))"/gi;
    while ((match = imgRegex.exec(html)) !== null) {
      if (!discoveredImages.includes(match[1])) discoveredImages.push(match[1]);
    }

    // --- Extract product names from structured markup ---
    const titleRegex = /<h[23][^>]*class="[^"]*(?:product|entry|item)[^"]*(?:title|name)[^"]*"[^>]*>([^<]+)<\/h[23]>/gi;
    while ((match = titleRegex.exec(html)) !== null) {
      const name = match[1].trim();
      if (!discovered.find(d => d.name.toLowerCase() === name.toLowerCase()) && name.length > 1) {
        discovered.push({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), url: null, images: [], price: null, description: "" });
      }
    }

    // --- Also try data attributes and alt text for product names ---
    const altRegex = /alt="([^"]{3,60})"[^>]*src="[^"]*(?:PRE-|FLW-|INF-|VAPE-|14P-)[^"]*"/gi;
    while ((match = altRegex.exec(html)) !== null) {
      const name = match[1].trim();
      if (!discovered.find(d => d.name.toLowerCase() === name.toLowerCase())) {
        discovered.push({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), url: null, images: [], price: null, description: "" });
      }
    }

    // --- Follow collection pages for more products (limit 3 pages) ---
    for (const colUrl of collectionUrls.slice(0, 3)) {
      try {
        const colResp = await fetch(colUrl, { headers });
        if (!colResp.ok) continue;
        const colHtml = await colResp.text();

        const colLinkRegex = /href="(https?:\/\/[^"]*\/product\/([^/"]+)\/?[^"]*)"/gi;
        while ((match = colLinkRegex.exec(colHtml)) !== null) {
          const slug = match[2];
          if (seenSlugs.has(slug)) continue;
          seenSlugs.add(slug);
          const name = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          discovered.push({ name, slug, url: match[1], images: [], price: null, description: "" });
        }

        // Grab images from collection page too
        const colImgRegex = /src="(https?:\/\/[^"]+\/wp-content\/uploads\/[^"]+\.(webp|jpg|png|jpeg))"/gi;
        while ((match = colImgRegex.exec(colHtml)) !== null) {
          if (!discoveredImages.includes(match[1])) discoveredImages.push(match[1]);
        }
      } catch (e) { /* skip failed collection pages */ }
    }

    // --- Follow individual product pages for details (limit 20, parallel batches of 5) ---
    const toScrape = discovered.filter(d => d.url).slice(0, 20);
    for (let i = 0; i < toScrape.length; i += 5) {
      const batch = toScrape.slice(i, i + 5);
      await Promise.all(batch.map(async (product) => {
        try {
          const pResp = await fetch(product.url, { headers });
          if (!pResp.ok) return;
          const pHtml = await pResp.text();

          // Price
          const priceMatch = pHtml.match(/<span class="[^"]*amount[^"]*">[^$]*\$([\d,.]+)/i);
          if (priceMatch) product.price = priceMatch[1];

          // Description
          const descMatch = pHtml.match(/<div[^>]*class="[^"]*(?:description|product-content|entry-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          if (descMatch) {
            product.description = descMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 300);
          }

          // Product images
          const pImgRegex = /src="(https?:\/\/[^"]+\/wp-content\/uploads\/[^"]+\.(webp|jpg|png|jpeg))"/gi;
          let pMatch;
          while ((pMatch = pImgRegex.exec(pHtml)) !== null) {
            if (!product.images.includes(pMatch[1])) product.images.push(pMatch[1]);
            if (!discoveredImages.includes(pMatch[1])) discoveredImages.push(pMatch[1]);
          }

          // Category from breadcrumb or markup
          const catMatch = pHtml.match(/product-category\/([^/"]+)/i);
          if (catMatch) product.category = catMatch[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        } catch (e) { /* skip failed product pages */ }
      }));
    }

    // --- Extract any prices from main page ---
    const priceRegex = /<span class="[^"]*amount[^"]*">[^<]*?(\$[\d,.]+)/gi;
    const prices = [];
    while ((match = priceRegex.exec(html)) !== null) {
      prices.push(match[1]);
    }

    // Check new vs existing
    const existingNames = new Set(Object.keys(productsDB.strains || {}).map(n => n.toLowerCase()));
    const results = discovered.map(d => ({
      ...d,
      isNew: !existingNames.has(d.name.toLowerCase()),
    }));

    logActivity("scrape", `Scrape complete: ${results.length} products (${results.filter(r => r.isNew).length} new) from ${startUrl}`);

    res.json({
      success: true,
      url: startUrl,
      totalFound: results.length,
      newProducts: results.filter(r => r.isNew).length,
      products: results,
      images: discoveredImages.slice(0, 50),
      prices,
    });
  } catch (err) {
    console.error("Scrape error:", err.message);
    res.status(500).json({ error: "Scrape failed: " + err.message });
  }
});

// Admin route - serve admin.html
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// --- SPA fallback ----------------------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

async function bootstrap() {
  if (gcsBucket) {
    await Promise.all([
      hydrateFromGCS(path.basename(PRODUCTS_FILE), PRODUCTS_FILE),
      hydrateFromGCS(path.basename(ACCOUNTS_FILE), ACCOUNTS_FILE),
      hydrateFromGCS(path.basename(RECEIPTS_FILE), RECEIPTS_FILE),
      hydrateFromGCS(path.basename(SCRAPE_SITES_FILE), SCRAPE_SITES_FILE),
    ]);
    // Re-read in-memory copies from the freshly hydrated files
    productsDB = loadProducts();
    accountsDB = loadJsonFile(ACCOUNTS_FILE, {});
    receiptsDB = loadJsonFile(RECEIPTS_FILE, []);
    scrapeSites = loadScrapeSites();
  }

  app.listen(PORT, () => {
    console.log(`\nDragonfly Scanner API running on port ${PORT}`);
    console.log(`  Notifications -> ${NOTIFY_EMAIL}`);
    console.log(`  Resend configured: ${!!process.env.RESEND_API_KEY}`);
    console.log(`  GCS persistence: ${gcsBucket ? `enabled (gs://${GCS_BUCKET}/${GCS_PREFIX})` : "disabled (local-only)"}`);
    console.log(`  Admin signups:   /api/signups${process.env.ADMIN_KEY ? "?key=***" : ""}`);
    console.log(`  Admin dashboard: /admin`);
    console.log(`  Products loaded: ${Object.keys(productsDB.strains || {}).length} strains`);
    console.log(`  Loyalty accounts: ${Object.keys(accountsDB).length}, receipts: ${receiptsDB.length}\n`);
  });
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
