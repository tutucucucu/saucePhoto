const express = require("express");
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");
const path = require("path");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, "public")));

function uid() { return crypto.randomBytes(8).toString("hex"); }

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiIiLCJhdWQiOiIiLCJpYXQiOjE1MjMzNjQ4MjQsIm5iZiI6MTUyMzM2NDgyNCwianRpIjoicHJvamVjdF9wdWJsaWNfYzkwNWRkMWMwMWU5ZmQ3NzY5ODNjYTQwZDBhOWQyZjNfT1Vzd2EwODA0MGI4ZDJjN2NhM2NjZGE2MGQ2MTBhMmRkY2U3NyJ9.qvHSXgCJgqpC4gd6-paUlDLFmg0o2DsOvb1EUYPYx_E";
const HEADERS = {
  "Authorization": "Bearer " + TOKEN,
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36",
  "Referer": "https://www.iloveimg.com/upscale-image"
};

// ── UPSCALE ──────────────────────────────────────────────────
app.post("/api/upscale/start", async (req, res) => {
  try {
    const r = await axios.post("https://api1g.iloveimg.com/v1/upscale", {}, { headers: HEADERS });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.response?.data || err.message }); }
});

app.post("/api/upscale/upload", upload.single("file"), async (req, res) => {
  const { server, task } = req.body;
  if (!server || !task || !req.file) return res.status(400).json({ error: "Missing params" });
  try {
    const form = new FormData();
    form.append("task", task);
    form.append("file", req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
    const r = await axios.post("https://" + server + ".iloveimg.com/v1/upload", form, {
      headers: Object.assign({}, HEADERS, form.getHeaders())
    });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.response?.data || err.message }); }
});

app.post("/api/upscale/process", async (req, res) => {
  const { server, task, files } = req.body;
  if (!server || !task || !files) return res.status(400).json({ error: "Missing params" });
  try {
    const r = await axios.post("https://" + server + ".iloveimg.com/v1/upscale/" + task,
      { task, files }, { headers: Object.assign({}, HEADERS, { "Content-Type": "application/json" }) });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.response?.data || err.message }); }
});

app.get("/api/upscale/download", async (req, res) => {
  const { server, task } = req.query;
  if (!server || !task) return res.status(400).send("Missing params");
  try {
    const r = await axios.get("https://" + server + ".iloveimg.com/v1/download/" + task,
      { headers: HEADERS, responseType: "stream" });
    res.setHeader("Content-Type", r.headers["content-type"] || "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=upscaled.zip");
    r.data.pipe(res);
  } catch (err) { res.status(500).send("Download failed"); }
});

// ── CONVERTER: IMAGE ─────────────────────────────────────────
app.post("/api/convert/image", upload.single("file"), async (req, res) => {
  const { format } = req.body;
  if (!req.file || !format) return res.status(400).json({ error: "Missing file or format" });
  const fmtMap = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", avif: "avif" };
  const fmt = fmtMap[format.toLowerCase()];
  if (!fmt) return res.status(400).json({ error: "Format tidak didukung" });
  try {
    const out = await sharp(req.file.buffer).toFormat(fmt).toBuffer();
    const ext = fmt === "jpeg" ? "jpg" : fmt;
    const origName = req.file.originalname.replace(/\.[^.]+$/, "");
    res.setHeader("Content-Type", "image/" + (fmt === "jpeg" ? "jpeg" : fmt));
    res.setHeader("Content-Disposition", 'attachment; filename="' + origName + "." + ext + '"');
    res.send(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CONVERTER: MEDIA (video/audio) ───────────────────────────
app.post("/api/convert/media", upload.single("file"), async (req, res) => {
  const { format } = req.body;
  if (!req.file || !format) return res.status(400).json({ error: "Missing file or format" });
  const allowed = ["mp3", "mp4", "wav", "aac", "ogg", "m4a"];
  const fmt = format.toLowerCase();
  if (!allowed.includes(fmt)) return res.status(400).json({ error: "Format tidak didukung" });

  const ext = path.extname(req.file.originalname || ".tmp") || ".tmp";
  const tmpIn = path.join(os.tmpdir(), uid() + ext);
  const tmpOut = path.join(os.tmpdir(), uid() + "." + fmt);

  try {
    fs.writeFileSync(tmpIn, req.file.buffer);

    await new Promise(function(resolve, reject) {
      var cmd = ffmpeg(tmpIn).output(tmpOut);
      if (fmt === "mp3") cmd.audioCodec("libmp3lame").audioBitrate("320k").noVideo();
      else if (fmt === "wav") cmd.audioCodec("pcm_s16le").noVideo();
      else if (fmt === "aac" || fmt === "m4a") cmd.audioCodec("aac").audioBitrate("192k").noVideo();
      else if (fmt === "ogg") cmd.audioCodec("libvorbis").noVideo();
      cmd.on("end", resolve).on("error", reject).run();
    });

    const mimeMap = { mp3:"audio/mpeg", mp4:"video/mp4", wav:"audio/wav", aac:"audio/aac", ogg:"audio/ogg", m4a:"audio/mp4" };
    const origName = req.file.originalname.replace(/\.[^.]+$/, "");
    res.setHeader("Content-Type", mimeMap[fmt] || "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="' + origName + "." + fmt + '"');
    const stream = fs.createReadStream(tmpOut);
    stream.pipe(res);
    stream.on("close", function() {
      try { fs.unlinkSync(tmpIn); } catch {}
      try { fs.unlinkSync(tmpOut); } catch {}
    });
  } catch (err) {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ── PAGES ─────────────────────────────────────────────────────
app.get("/upscale", (req, res) => res.sendFile(path.join(__dirname, "public", "upscale.html")));
app.get("/converter", (req, res) => res.sendFile(path.join(__dirname, "public", "converter.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SaucePhoto on port " + PORT));
module.exports = app;
      
