const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

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

// --- Drops persistence -------------------------------------------------------
const DROPS_FILE = path.join(DATA_DIR, "drops.json");

function loadDrops() {
  try {
    if (fs.existsSync(DROPS_FILE)) {
      return JSON.parse(fs.readFileSync(DROPS_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Error loading drops.json:", err.message);
  }
  return { drops: {} };
}

function saveDrops(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DROPS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving drops.json:", err.message);
  }
}

let dropsDB = loadDrops();

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

// --- Claude Vision API Proxy ----------------------------------------------
// Keeps the Anthropic API key server-side. Frontend POSTs image to /api/scan,
// server forwards to Claude, returns the strain name.
// Set ANTHROPIC_API_KEY as a Cloud Run environment variable.

app.post("/api/scan", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server." });
  }

  const { image_base64, media_type, strain_list } = req.body;
  if (!image_base64 || !strain_list) {
    return res.status(400).json({ error: "image_base64 and strain_list are required." });
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
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: media_type || "image/jpeg", data: image_base64 }
            },
            {
              type: "text",
              text: `You are a cannabis product identifier for the Dragonfly brand.

PACKAGING DETAILS: Dragonfly products have a distinctive red tube/container with GOLD text for the brand name "DRAGONFLY" and product type (e.g. "PREROLL"), and BLACK text for the strain name, THC percentage, and other details. There is typically a gold dragonfly logo/emblem at the top. The strain name is usually the most prominent BLACK text on the red background, located below the word "PREROLL" or product type.

Product types include: prerolls (1g joints), flower jars, vape cartridges, all-in-one vapes, 14-packs, premium ounces, and gummies.

The complete list of Dragonfly strain names is: ${strain_list}

TASK: Look at this product photo and identify the strain name. Read the BLACK text on the red packaging carefully -- that's where the strain name is.

Rules:
- The strain name appears in BLACK TEXT below the product type on the RED packaging
- If you can identify the strain, respond with ONLY the exact strain name from the list above
- If you see a strain name that's close but not an exact match in the list, still respond with what you read -- we'll match it
- If you truly cannot identify any strain from the image, respond with exactly: UNKNOWN
- Respond with ONLY the strain name -- no explanation, no extra words`
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
    const strain = result.content?.[0]?.text?.trim() || "UNKNOWN";
    console.log(`Vision scan result: "${strain}"`);

    // Track scan
    scanCount++;
    recentScans.unshift({ strain, timestamp: new Date().toISOString() });
    if (recentScans.length > 50) recentScans.length = 50;
    logActivity("scan", `Scanned: ${strain}`);

    res.json({ strain });
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

// --- Drops static files (thumbnails) -----------------------------------------
app.use("/drops", express.static(path.join(__dirname, "public", "drops")));

// --- Public Drops API --------------------------------------------------------
app.get("/api/drops", (req, res) => {
  res.json(dropsDB);
});

// --- Admin Drops API ---------------------------------------------------------

// Get all drops
app.get("/api/admin/drops", requireAdmin, (req, res) => {
  res.json(dropsDB);
});

// Create a new drop
app.post("/api/admin/drops", requireAdmin, (req, res) => {
  const { id, name, region, date, description } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: "Drop id and name are required." });
  }
  if (dropsDB.drops[id]) {
    return res.status(409).json({ error: `Drop "${id}" already exists.` });
  }
  dropsDB.drops[id] = { name, region: region || "", date: date || "", description: description || "", types: {} };
  saveDrops(dropsDB);
  logActivity("drop_add", `Added drop: ${name} (${id})`);
  res.json({ success: true, drop: dropsDB.drops[id] });
});

// Update drop metadata
app.put("/api/admin/drops/:id", requireAdmin, (req, res) => {
  const id = decodeURIComponent(req.params.id);
  if (!dropsDB.drops[id]) {
    return res.status(404).json({ error: `Drop "${id}" not found.` });
  }
  const { name, region, date, description } = req.body;
  if (name !== undefined) dropsDB.drops[id].name = name;
  if (region !== undefined) dropsDB.drops[id].region = region;
  if (date !== undefined) dropsDB.drops[id].date = date;
  if (description !== undefined) dropsDB.drops[id].description = description;
  saveDrops(dropsDB);
  logActivity("drop_update", `Updated drop: ${id}`);
  res.json({ success: true, drop: dropsDB.drops[id] });
});

// Delete a drop
app.delete("/api/admin/drops/:id", requireAdmin, (req, res) => {
  const id = decodeURIComponent(req.params.id);
  if (!dropsDB.drops[id]) {
    return res.status(404).json({ error: `Drop "${id}" not found.` });
  }
  delete dropsDB.drops[id];
  saveDrops(dropsDB);
  logActivity("drop_delete", `Deleted drop: ${id}`);
  res.json({ success: true });
});

// Add/update a type within a drop
app.post("/api/admin/drops/:id/types/:type", requireAdmin, (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const type = decodeURIComponent(req.params.type);
  if (!dropsDB.drops[id]) {
    return res.status(404).json({ error: `Drop "${id}" not found.` });
  }
  if (!dropsDB.drops[id].types) dropsDB.drops[id].types = {};
  const { patternName, patternDescription, fingerprint, thumbPattern, thumbColor } = req.body;
  dropsDB.drops[id].types[type] = {
    ...(dropsDB.drops[id].types[type] || {}),
    patternName: patternName !== undefined ? patternName : (dropsDB.drops[id].types[type]?.patternName || ""),
    patternDescription: patternDescription !== undefined ? patternDescription : (dropsDB.drops[id].types[type]?.patternDescription || ""),
    fingerprint: fingerprint !== undefined ? fingerprint : (dropsDB.drops[id].types[type]?.fingerprint || null),
    thumbPattern: thumbPattern !== undefined ? thumbPattern : (dropsDB.drops[id].types[type]?.thumbPattern || ""),
    thumbColor: thumbColor !== undefined ? thumbColor : (dropsDB.drops[id].types[type]?.thumbColor || ""),
  };
  saveDrops(dropsDB);
  logActivity("drop_type_add", `Added/updated type "${type}" in drop "${id}"`);
  res.json({ success: true, type: dropsDB.drops[id].types[type] });
});

// Delete a type from a drop
app.delete("/api/admin/drops/:id/types/:type", requireAdmin, (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const type = decodeURIComponent(req.params.type);
  if (!dropsDB.drops[id]) {
    return res.status(404).json({ error: `Drop "${id}" not found.` });
  }
  if (!dropsDB.drops[id].types || !dropsDB.drops[id].types[type]) {
    return res.status(404).json({ error: `Type "${type}" not found in drop "${id}".` });
  }
  delete dropsDB.drops[id].types[type];
  saveDrops(dropsDB);
  logActivity("drop_type_delete", `Deleted type "${type}" from drop "${id}"`);
  res.json({ success: true });
});

// Upload image for a type, generate thumbnail and fingerprint
app.post("/api/admin/drops/:id/upload/:type/:imageType", requireAdmin, async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const type = decodeURIComponent(req.params.type);
  const imageType = decodeURIComponent(req.params.imageType);

  if (!["patterns", "colors"].includes(imageType)) {
    return res.status(400).json({ error: "imageType must be 'patterns' or 'colors'." });
  }
  if (!dropsDB.drops[id]) {
    return res.status(404).json({ error: `Drop "${id}" not found.` });
  }

  const { image_base64 } = req.body;
  if (!image_base64) {
    return res.status(400).json({ error: "image_base64 is required." });
  }

  try {
    const imgBuffer = Buffer.from(image_base64, "base64");

    // Create thumbnail directory
    const thumbDir = path.join(__dirname, "public", "drops", id, "thumbs", imageType);
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

    // Save 300px thumbnail
    const thumbPath = path.join(thumbDir, `${type}.jpg`);
    await sharp(imgBuffer)
      .resize(300, 300, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toFile(thumbPath);

    // Generate fingerprint: dominant color from 4x4 resize
    const colorData = await sharp(imgBuffer)
      .resize(4, 4, { fit: "cover" })
      .raw()
      .toBuffer();

    let rSum = 0, gSum = 0, bSum = 0;
    for (let i = 0; i < 16; i++) {
      rSum += colorData[i * 3];
      gSum += colorData[i * 3 + 1];
      bSum += colorData[i * 3 + 2];
    }
    const dominantColor = {
      r: Math.round(rSum / 16),
      g: Math.round(gSum / 16),
      b: Math.round(bSum / 16),
    };

    // Generate fingerprint: luminance grid from 8x8 resize
    const gridData = await sharp(imgBuffer)
      .resize(8, 8, { fit: "cover" })
      .raw()
      .toBuffer();

    const grid = [];
    for (let i = 0; i < 64; i++) {
      const r = gridData[i * 3];
      const g = gridData[i * 3 + 1];
      const b = gridData[i * 3 + 2];
      grid.push(0.299 * r + 0.587 * g + 0.114 * b);
    }

    // Generate phash: compare to mean luminance
    const mean = grid.reduce((a, b) => a + b, 0) / grid.length;
    const phash = grid.map(v => (v >= mean ? "1" : "0")).join("");

    const fingerprint = { dominantColor, grid, phash };

    const thumbUrl = `/drops/${id}/thumbs/${imageType}/${type}.jpg`;

    logActivity("drop_upload", `Uploaded ${imageType} image for type "${type}" in drop "${id}"`);

    res.json({
      success: true,
      fingerprint,
      thumbUrl,
    });
  } catch (err) {
    console.error("Drop image upload error:", err.message);
    res.status(500).json({ error: "Image processing failed: " + err.message });
  }
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
