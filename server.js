const express = require(“express”);
const nodemailer = require(“nodemailer”);
const cors = require(“cors”);
const path = require(“path”);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: “10mb” }));

// Serve static frontend build in production
app.use(express.static(path.join(__dirname, “dist”)));

// ─── Claude Vision API Proxy ──────────────────────────────────────────────
// Keeps the Anthropic API key server-side. Frontend POSTs image to /api/scan,
// server forwards to Claude, returns the strain name.
// Set ANTHROPIC_API_KEY as a Railway environment variable.

app.post(”/api/scan”, async (req, res) => {
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
return res.status(500).json({ error: “ANTHROPIC_API_KEY not configured on server.” });
}

const { image_base64, media_type, strain_list } = req.body;
if (!image_base64 || !strain_list) {
return res.status(400).json({ error: “image_base64 and strain_list are required.” });
}

try {
const response = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: {
“Content-Type”: “application/json”,
“x-api-key”: apiKey,
“anthropic-version”: “2023-06-01”,
},
body: JSON.stringify({
model: “claude-sonnet-4-20250514”,
max_tokens: 300,
messages: [{
role: “user”,
content: [
{
type: “image”,
source: { type: “base64”, media_type: media_type || “image/jpeg”, data: image_base64 }
},
{
type: “text”,
text: `You are a cannabis product identifier for the Dragonfly brand.

PACKAGING DETAILS: Dragonfly products have distinctive red packaging with a GOLD dragonfly logo and GOLD brand name “DRAGONFLY”. The strain name appears in BLACK text on the label or on a white sticker. Product types are printed in WHITE or GOLD text (e.g. “PREROLL”, “PREMIUM DISPOSABLE VAPORIZER”, “FLOWER”, etc).

Product types include: Preroll 1g, Infused Preroll 1.25g, Flower 3.5g, Vape Cart 1g, AIO Vape 1g, Premium Disposable Vaporizer, 14 Pack Prerolls, 1oz Premium Flower, Gummies.

The complete list of Dragonfly strain names is: ${strain_list}

TASK: Identify the strain name AND the product type from this photo.

Respond with ONLY a JSON object in this exact format, nothing else:
{“strain”:“STRAIN NAME HERE”,“product_type”:“PRODUCT TYPE HERE”}

If you can identify the strain but not the product type, use “Preroll 1g” as default.
If you cannot identify the strain, respond with: {“strain”:“UNKNOWN”,“product_type”:“UNKNOWN”}`
}
]
}]
})
});

```
if (!response.ok) {
  const errText = await response.text();
  console.error("Anthropic API error:", response.status, errText);
  return res.status(502).json({ error: "Vision API request failed", status: response.status });
}

const result = await response.json();
const rawText = result.content?.[0]?.text?.trim() || "UNKNOWN";
console.log(`🔍 Vision raw response: "${rawText}"`);

// Try to parse as JSON (new format: {"strain":"...", "product_type":"..."})
let strain = "UNKNOWN";
let productType = null;
try {
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  strain = parsed.strain || "UNKNOWN";
  productType = parsed.product_type || null;
} catch (e) {
  // Fallback: treat as plain text strain name (old format)
  strain = rawText;
}

console.log(`🔍 Identified strain: "${strain}", product: "${productType}"`);
res.json({ strain, product_type: productType });
```

} catch (err) {
console.error(“Vision proxy error:”, err.message);
res.status(500).json({ error: “Vision scan failed: “ + err.message });
}
});

// ─── Email Configuration ───────────────────────────────────────────────────
// Set these as Railway environment variables:
//   SMTP_HOST=smtp.gmail.com (or your provider)
//   SMTP_PORT=587
//   SMTP_USER=your-email@gmail.com
//   SMTP_PASS=your-app-password
//   NOTIFY_EMAIL=sasha@dopestr.com
//   FROM_EMAIL=noreply@dragonflybrandny.com

const transporter = nodemailer.createTransport({
host: process.env.SMTP_HOST || “smtp.gmail.com”,
port: parseInt(process.env.SMTP_PORT || “587”),
secure: false,
auth: {
user: process.env.SMTP_USER,
pass: process.env.SMTP_PASS,
},
});

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || “sasha@dopestr.com”;
const FROM_EMAIL = process.env.FROM_EMAIL || “noreply@dragonflybrandny.com”;

// ─── In-memory signup log (persists until server restart) ──────────────────
const signups = [];

// ─── Signup Endpoint ───────────────────────────────────────────────────────
app.post(”/api/signup”, async (req, res) => {
const { name, email, phone, strain } = req.body;

// Validation
if (!name || !email) {
return res.status(400).json({ error: “Name and email are required.” });
}

const timestamp = new Date().toLocaleString(“en-US”, {
timeZone: “America/New_York”,
weekday: “short”,
year: “numeric”,
month: “short”,
day: “numeric”,
hour: “2-digit”,
minute: “2-digit”,
});

// Store in memory
const entry = { name, email, phone: phone || “Not provided”, strain: strain || “None”, timestamp };
signups.push(entry);

// Build email
const htmlBody = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;"> <div style="background: #0a0a0a; padding: 32px; border-radius: 12px;"> <div style="text-align: center; margin-bottom: 24px;"> <h1 style="color: #c8ff00; font-size: 24px; margin: 0; letter-spacing: 2px;">DRAGONFLY</h1> <p style="color: #888; font-size: 13px; margin: 4px 0 0;">New Scanner Signup</p> </div> <div style="background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px; margin-bottom: 16px;"> <table style="width: 100%; border-collapse: collapse;"> <tr> <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top; width: 100px;">Name</td> <td style="color: #fff; font-size: 15px; padding: 8px 0; font-weight: 600;">${name}</td> </tr> <tr> <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top;">Email</td> <td style="color: #fff; font-size: 15px; padding: 8px 0;"><a href="mailto:${email}" style="color: #c8ff00; text-decoration: none;">${email}</a></td> </tr> <tr> <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top;">Phone</td> <td style="color: #fff; font-size: 15px; padding: 8px 0;">${phone || "Not provided"}</td> </tr> ${strain ?`
<tr>
<td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top;">Strain</td>
<td style="color: #fff; font-size: 15px; padding: 8px 0;">${strain} (was viewing when signed up)</td>
</tr>`: ""} <tr> <td style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; vertical-align: top;">Time</td> <td style="color: #fff; font-size: 15px; padding: 8px 0;">${timestamp}</td> </tr> </table> </div> <div style="text-align: center; color: #555; font-size: 11px; margin-top: 16px;"> Dragonfly Product Scanner · Signup #${signups.length} </div> </div> </div>`;

const textBody = `DRAGONFLY — New Scanner Signup ────────────────────────────── Name:    ${name} Email:   ${email} Phone:   ${phone || "Not provided"} Strain:  ${strain || "None"} Time:    ${timestamp} Signup #${signups.length}`.trim();

// Send email
try {
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
await transporter.sendMail({
from: `"Dragonfly Scanner" <${FROM_EMAIL}>`,
to: NOTIFY_EMAIL,
subject: `🐉 New Signup: ${name} — Dragonfly Scanner`,
text: textBody,
html: htmlBody,
});
console.log(`✅ Email sent to ${NOTIFY_EMAIL} for signup: ${name} <${email}>`);
} else {
console.log(`⚠️  SMTP not configured — signup logged but email not sent.`);
console.log(`    To enable emails, set SMTP_USER and SMTP_PASS env vars.`);
}

```
// Always log to console as backup
console.log(`📝 Signup #${signups.length}: ${name} | ${email} | ${phone || "no phone"} | Strain: ${strain || "none"} | ${timestamp}`);

return res.json({
  success: true,
  message: "Signup received! You'll hear from us soon.",
});
```

} catch (err) {
console.error(“❌ Email send error:”, err.message);

```
// Still save the signup even if email fails
console.log(`📝 Signup #${signups.length} (email failed): ${name} | ${email} | ${phone || "no phone"}`);

return res.json({
  success: true,
  message: "Signup received! You'll hear from us soon.",
  emailWarning: "Notification email could not be sent — signup was still recorded.",
});
```

}
});

// ─── View all signups (internal/admin) ─────────────────────────────────────
app.get(”/api/signups”, (req, res) => {
const key = req.query.key;
// Simple auth — set ADMIN_KEY env var on Railway
if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
return res.status(401).json({ error: “Unauthorized” });
}
res.json({ total: signups.length, signups });
});

// ─── Health check ──────────────────────────────────────────────────────────
app.get(”/api/health”, (req, res) => {
res.json({
status: “ok”,
uptime: process.uptime(),
signups: signups.length,
emailConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
});
});

// ─── SPA fallback ──────────────────────────────────────────────────────────
app.get(”*”, (req, res) => {
res.sendFile(path.join(__dirname, “dist”, “index.html”));
});

app.listen(PORT, () => {
console.log(`\n🐉 Dragonfly Scanner API running on port ${PORT}`);
console.log(`   Notifications → ${NOTIFY_EMAIL}`);
console.log(`   SMTP configured: ${!!(process.env.SMTP_USER && process.env.SMTP_PASS)}`);
console.log(`   Admin signups:   /api/signups${process.env.ADMIN_KEY ? "?key=***" : ""}\n`);
});