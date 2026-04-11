const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3001;

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
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving products.json:", err.message);
  }
}

let productsDB = loadProducts();

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

If this is a cannabis product: OCR the label and extract strain name, product type, THC%, brand, and weight.
If this is NOT a cannabis product at all (food, drink, random object, etc.): still identify what it is.

THC READING RULES:
- For vapes/cartridges/disposables: THC is usually 80-95%. Look for the HIGHEST percentage on the label. If you see "85.10%" or "851 mg/g" that means 85.1% THC.
- mg/g to percentage: divide by 10 (e.g. 851 mg/g = 85.1%)
- If multiple THC numbers appear, use the highest one for vapes, or the one labeled "Total THC" or "THC"
- For flower/prerolls: THC is usually 15-35%

In ALL cases, write a short witty one-liner ("roast") as if you're a sarcastic budtender who only respects Dragonfly products. Be funny, not mean. Reference what you actually see.

Examples of roasts:
- Coffee cup: "Caffeine? Cute. Come back when you're ready for the real wake-and-bake."
- Competitor weed: "We see you settling. Dragonfly would never."
- A shoe: "Interesting strain. What's the THC on that, 0%?"
- Dragonfly product: "Now THAT'S what we're talking about. Excellent taste."

Respond ONLY with valid JSON:
{"strain": "strain name or what the object is", "product_type": "product type from label or object type", "thc": "THC% or null", "brand": "brand name or null", "weight": "weight or null", "all_text": "other label text", "is_cannabis": true/false, "is_dragonfly": true/false, "roast": "your witty one-liner about what you see"}`
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

// --- Health check ----------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    signups: signups.length,
    resendConfigured: !!process.env.RESEND_API_KEY,
  });
});

// --- Admin API Endpoints ---------------------------------------------------

// Stats
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const uptimeSec = Math.floor((Date.now() - serverStartTime) / 1000);
  const hours = Math.floor(uptimeSec / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const secs = uptimeSec % 60;

  res.json({
    scanCount,
    signupCount: signups.length,
    productCount: Object.keys(productsDB.strains || {}).length,
    uptime: `${hours}h ${mins}m ${secs}s`,
    uptimeSeconds: uptimeSec,
    recentScans: recentScans.slice(0, 20),
    recentActivity: activityLog.slice(0, 30),
    signups: signups.slice(-20).reverse(),
  });
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
    fs.writeFileSync(SCRAPE_SITES_FILE, JSON.stringify(sites, null, 2), "utf-8");
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

app.listen(PORT, () => {
  console.log(`\nDragonfly Scanner API running on port ${PORT}`);
  console.log(`  Notifications -> ${NOTIFY_EMAIL}`);
  console.log(`  Resend configured: ${!!process.env.RESEND_API_KEY}`);
  console.log(`  Admin signups:   /api/signups${process.env.ADMIN_KEY ? "?key=***" : ""}`);
  console.log(`  Admin dashboard: /admin`);
  console.log(`  Products loaded: ${Object.keys(productsDB.strains || {}).length} strains\n`);
});
