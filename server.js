const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "dist")));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "sasha@dopestr.com";
const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@dragonflybrandny.com";

const signups = [];

app.post("/api/signup", async (req, res) => {
  const { name, email, phone, strain } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York", weekday: "short", year: "numeric",
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const entry = { name, email, phone: phone || "Not provided", strain: strain || "None", timestamp };
  signups.push(entry);

  const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto"><div style="background:#0a0a0a;padding:32px;border-radius:12px"><div style="text-align:center;margin-bottom:24px"><h1 style="color:#c8ff00;font-size:24px;margin:0;letter-spacing:2px">DRAGONFLY</h1><p style="color:#888;font-size:13px;margin:4px 0 0">New Scanner Signup</p></div><div style="background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin-bottom:16px"><table style="width:100%;border-collapse:collapse"><tr><td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:8px 0;vertical-align:top;width:100px">Name</td><td style="color:#fff;font-size:15px;padding:8px 0;font-weight:600">${name}</td></tr><tr><td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:8px 0;vertical-align:top">Email</td><td style="color:#fff;font-size:15px;padding:8px 0"><a href="mailto:${email}" style="color:#c8ff00;text-decoration:none">${email}</a></td></tr><tr><td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:8px 0;vertical-align:top">Phone</td><td style="color:#fff;font-size:15px;padding:8px 0">${phone || "Not provided"}</td></tr>${strain ? `<tr><td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:8px 0;vertical-align:top">Strain</td><td style="color:#fff;font-size:15px;padding:8px 0">${strain} (viewing when signed up)</td></tr>` : ""}<tr><td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:8px 0;vertical-align:top">Time</td><td style="color:#fff;font-size:15px;padding:8px 0">${timestamp}</td></tr></table></div><div style="text-align:center;color:#555;font-size:11px;margin-top:16px">Dragonfly Product Scanner - Signup #${signups.length}</div></div></div>`;

  const textBody = `DRAGONFLY - New Scanner Signup\nName: ${name}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\nStrain: ${strain || "None"}\nTime: ${timestamp}\nSignup #${signups.length}`;

  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.sendMail({
        from: `"Dragonfly Scanner" <${FROM_EMAIL}>`,
        to: NOTIFY_EMAIL,
        subject: `New Signup: ${name} - Dragonfly Scanner`,
        text: textBody, html: htmlBody,
      });
      console.log(`Email sent to ${NOTIFY_EMAIL} for signup: ${name} <${email}>`);
    } else {
      console.log(`SMTP not configured - signup logged but email not sent.`);
    }
    console.log(`Signup #${signups.length}: ${name} | ${email} | ${phone || "no phone"} | Strain: ${strain || "none"} | ${timestamp}`);
    return res.json({ success: true, message: "Signup received! You'll hear from us soon." });
  } catch (err) {
    console.error("Email send error:", err.message);
    console.log(`Signup #${signups.length} (email failed): ${name} | ${email} | ${phone || "no phone"}`);
    return res.json({ success: true, message: "Signup received!", emailWarning: "Email could not be sent - signup was still recorded." });
  }
});

app.get("/api/signups", (req, res) => {
  const key = req.query.key;
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ total: signups.length, signups });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), signups: signups.length, emailConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS) });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\nDragonfly Scanner API running on port ${PORT}`);
  console.log(`   Notifications -> ${NOTIFY_EMAIL}`);
  console.log(`   SMTP configured: ${!!(process.env.SMTP_USER && process.env.SMTP_PASS)}`);
  console.log(`   Admin signups: /api/signups${process.env.ADMIN_KEY ? "?key=***" : ""}\n`);
});
