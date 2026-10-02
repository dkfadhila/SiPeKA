// SiPeKA — API server (Node http, zero deps)
// Endpoint: login, change-password, transaksi (Setor Nota & Pengajuan Dana), closing (Daily Report), Widya AI (owner only)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { q, verifyPassword, hashPassword, uid, DEMO_PASSWORD } = require("./db");

const PORT = process.env.PORT || 4321;
const KARA_BASE = process.env.KARA_BASE_URL || "http://localhost:20128/v1";
const KARA_KEY = process.env.KARA_API_KEY || "";
const KARA_MODEL = process.env.KARA_MODEL || "ag/gemini-3.8-flash-medium";

const PUBLIC_DIR = path.join(__dirname, "public");
const HTML_PATH = path.join(PUBLIC_DIR, "financial-dashboard.html");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads", "receipts");
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}

// ---------- utils ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

function auth(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return null;
  try { return q.getSession.get(token) || null; } catch { return null; }
}

// ---------- guardrails Widya (owner only) ----------
function widyaSystemPrompt(context) {
  return `Kamu adalah Widya (panggilan: Widya) — Head of Accounting AI di sistem SiPeKA.
Aturan:
- Jawab Bahasa Indonesia, ringkas, format Rupiah id-ID (Rp 123.456).
- Gunakan HANYA angka dari KONTEKS DATA. DILARANG mengarang angka.
- Role owner memiliki akses penuh semua cabang.
- Kamu tidak mengeksekusi aksi final: pengeluaran > Rp 500.000 tetap menunggu approval owner.

=== KONTEKS DATA ===
${context}`;
}

async function callWidya(messages) {
  const txs = q.txAll.all().slice(0, 40);
  const perf = q.staffPerf.all();
  const lines = txs.map((t) =>
    `${t.created_at} | ${t.branch_name} | ${t.user_name} | ${t.tx_type} | ${t.account_name} | ${t.memo || "-"} | Rp ${t.amount.toLocaleString("id-ID")} | ${t.payment_method} | ${t.status} | [${t.tx_intent || 'SETOR_NOTA'}]`
  );
  const perfLines = perf.map((p) =>
    `${p.full_name} (@${p.username}) @ ${p.branch_name}: ${p.tx_count} transaksi, income Rp ${p.income.toLocaleString("id-ID")}, expense Rp ${p.expense.toLocaleString("id-ID")}, hari ini ${p.today_count}`
  );
  const context = [
    `Ledger saat ini (terbaru):`,
    lines.length ? lines.join("\n") : "(ledger kosong — belum ada transaksi)",
    ``,
    `Kinerja staf:`,
    perfLines.length ? perfLines.join("\n") : "(belum ada staf bertransaksi)",
  ].join("\n");

  const res = await fetch(`${KARA_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KARA_KEY}` },
    body: JSON.stringify({
      model: KARA_MODEL,
      stream: true,
      temperature: 0.3,
      max_tokens: 1200,
      messages: [
        { role: "system", content: widyaSystemPrompt(context) },
        ...messages.slice(-12),
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok || !res.body) throw new Error(`upstream ${res.status}`);

  const decoder = new TextDecoder();
  let buf = "";
  let reply = "";
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines2 = buf.split("\n");
    buf = lines2.pop() ?? "";
    for (const line of lines2) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        reply += j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? "";
      } catch {}
    }
  }
  return reply;
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") return json(res, 204, {});

  // ---- auth endpoints ----
  if (p === "/api/login" && req.method === "POST") {
    const { username, password } = await readBody(req);
    const user = q.userByUsername.get(String(username || "").toLowerCase());
    if (!user || !verifyPassword(String(password || ""), user.password_hash))
      return json(res, 401, { error: "Username atau password salah" });
    const token = uid();
    q.createSession.run(token, user.id);
    return json(res, 200, {
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        branch_id: user.assigned_branch_id,
      },
    });
  }

  if (p === "/api/logout" && req.method === "POST") {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (token) q.dropSession.run(token);
    return json(res, 200, { ok: true });
  }

  // ---- protected endpoints ----
  const me = auth(req);
  if (p.startsWith("/api/") && !me) return json(res, 401, { error: "unauthorized" });

  if (p === "/api/me" && req.method === "GET") {
    return json(res, 200, {
      id: me.id, username: me.username, full_name: me.full_name,
      role: me.role, branch_id: me.assigned_branch_id,
    });
  }

  // ---- Ganti password (Staff & Owner) ----
  if (p === "/api/change-password" && req.method === "POST") {
    const { old_password, new_password } = await readBody(req);
    if (!old_password || !new_password)
      return json(res, 400, { error: "Password lama dan baru wajib diisi" });
    if (String(new_password).length < 6)
      return json(res, 400, { error: "Password baru minimal 6 karakter" });
    const user = q.userById.get(me.id);
    if (!user || !verifyPassword(String(old_password), user.password_hash))
      return json(res, 400, { error: "Password lama tidak sesuai" });
    const newHash = hashPassword(String(new_password));
    q.updateUserPassword.run(newHash, me.id);
    return json(res, 200, { ok: true, message: "Password berhasil diperbarui" });
  }

  if (p === "/api/units" && req.method === "GET") {
    if (me.role === "STAFF") {
      const u = me.assigned_branch_id ? q.unitById.get(me.assigned_branch_id) : null;
      return json(res, 200, u ? [u] : []);
    }
    return json(res, 200, q.allUnits.all());
  }

  if (p === "/api/transactions" && req.method === "GET") {
    if (me.role === "STAFF") {
      const rows = q.txStaffToday.all(me.id, me.assigned_branch_id);
      return json(res, 200, { scope: "today-own", rows });
    }
    return json(res, 200, { scope: "all", rows: q.txAll.all() });
  }

  // Transaksi Operasional: Setor Nota & Pengajuan Dana Lapangan
  if (p === "/api/transactions" && req.method === "POST") {
    const b = await readBody(req);
    const amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount <= 0 || !Number.isFinite(Number(b.amount)))
      return json(res, 400, { error: "Nominal uang harus berupa angka positif rupiah" });
    
    const method = b.payment_method || "CASH_DRAWER";
    if (!["CASH_DRAWER", "QRIS", "BANK_TRANSFER"].includes(method))
      return json(res, 400, { error: "Metode pembayaran tidak valid" });
    
    const txType = b.tx_type || "EXPENSE";
    if (!["INCOME", "EXPENSE"].includes(txType))
      return json(res, 400, { error: "tx_type tidak valid" });

    const txIntent = b.tx_intent === "PENGAJUAN_DANA" ? "PENGAJUAN_DANA" : "SETOR_NOTA";

    // Scope cabang
    let branchId = b.branch_id;
    if (me.role === "STAFF") {
      branchId = me.assigned_branch_id;
      if (!branchId) return json(res, 403, { error: "Anda tidak terikat unit bisnis manapun" });
    }
    const unit = q.unitById.get(branchId);
    if (!unit) return json(res, 400, { error: "Unit bisnis tidak ditemukan" });

    const coa = b.coa_id || "5101";
    const idem = b.idempotency_key || uid();
    const existing = q.txByIdempotency.get(idem);
    if (existing) return json(res, 200, { ok: true, id: existing.id, idempotent: true });

    // Status: Pengajuan Dana selalu PENDING_APPROVAL; Setor nota > 500rb juga PENDING_APPROVAL
    let status = "APPROVED";
    if (txIntent === "PENGAJUAN_DANA" || amount > 500000) {
      status = "PENDING_APPROVAL";
    }

    const id = (txIntent === "PENGAJUAN_DANA" ? "ADV-" : "TX-") + uid().slice(0, 10).toUpperCase();
    q.insertTx.run(id, idem, branchId, me.id, coa, txType, amount, method,
      String(b.memo || ""), b.receipt_key || null, status, txIntent);
    return json(res, 201, { ok: true, id, status, tx_intent: txIntent });
  }

  // ---- Approvals (Owner Only) ----
  if (p === "/api/approvals" && req.method === "POST") {
    if (me.role !== "OWNER")
      return json(res, 403, { error: "Hanya Owner yang berhak melakukan approval transaksi" });
    const b = await readBody(req);
    const id = String(b.id || "").trim();
    const action = String(b.action || "").toUpperCase();
    if (!id || !["APPROVED", "REJECTED"].includes(action))
      return json(res, 400, { error: "id dan action (APPROVED/REJECTED) wajib diisi" });
    const tx = q.txById.get(id);
    if (!tx) return json(res, 404, { error: "Transaksi tidak ditemukan" });
    q.updateTxStatus.run(action, id);
    q.insertApprovalLog.run(uid(), id, action, me.id, String(b.notes || ""));
    return json(res, 200, { ok: true, id, status: action });
  }

  // ---- Daily Report Closing (Tutup Shift Kasir) ----
  if (p === "/api/closing/summary" && req.method === "GET") {
    const branchId = me.role === "STAFF"
      ? me.assigned_branch_id
      : (url.searchParams.get("branch_id") || "UNIT_LP");
    const sysBal = q.cashDrawerBalanceToday.get(branchId)?.balance || 0;
    const closings = me.role === "STAFF"
      ? q.closingsByBranchToday.all(me.assigned_branch_id)
      : q.allClosingsToday.all();
    return json(res, 200, {
      branch_id: branchId,
      system_balance: sysBal,
      closings,
    });
  }

  if (p === "/api/closing" && req.method === "POST") {
    const b = await readBody(req);
    const branchId = me.role === "STAFF"
      ? me.assigned_branch_id
      : (b.branch_id || me.assigned_branch_id || "UNIT_LP");
    if (!branchId) return json(res, 400, { error: "Unit bisnis tidak valid" });
    
    const sysBal = q.cashDrawerBalanceToday.get(branchId)?.balance || 0;
    const phys = Number(b.physical_cash);
    if (!Number.isFinite(phys) || phys < 0)
      return json(res, 400, { error: "Uang yang ada di laci kasir tidak valid" });
    
    const diff = phys - sysBal;
    if (diff !== 0 && !String(b.reason || "").trim())
      return json(res, 400, { error: "Alasan selisih wajib diisi jika uang fisik laci tidak sama dengan sistem" });
    
    const id = "CLS-" + uid().slice(0, 8).toUpperCase();
    q.insertClosing.run(
      id, branchId, me.id, sysBal, phys, diff, String(b.reason || ""),
      Number(b.total_nota) || 0,
      Number(b.kg_reguler) || 0,
      Number(b.kg_express) || 0,
      Number(b.kg_kilat) || 0,
      Number(b.income_cash) || 0,
      Number(b.income_qris) || 0,
      Number(b.income_transfer) || 0,
      Number(b.stock_detergent) || 0,
      Number(b.stock_perfume) || 0,
      String(b.operational_notes || "")
    );
    return json(res, 201, {
      ok: true,
      id,
      system_balance: sysBal,
      physical_cash: phys,
      difference: diff,
    });
  }

  if (p === "/api/closings" && req.method === "GET") {
    const closings = me.role === "STAFF"
      ? q.closingsByBranchToday.all(me.assigned_branch_id)
      : q.allClosingsToday.all();
    return json(res, 200, closings);
  }

  if (p === "/api/staff-performance" && req.method === "GET") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Hanya Owner yang boleh melihat kinerja staf" });
    return json(res, 200, q.staffPerf.all());
  }

  if ((p === "/api/widya" || p === "/api/dewi") && req.method === "POST") {
    if (me.role !== "OWNER")
      return json(res, 403, { error: "Akses Widya hanya untuk Owner" });
    const b = await readBody(req);
    const messages = Array.isArray(b.messages) ? b.messages : [];
    if (!messages.length) return json(res, 400, { error: "messages required" });
    try {
      const reply = await callWidya(messages);
      return json(res, 200, { reply });
    } catch (e) {
      console.error("[widya]", e.message);
      return json(res, 502, { error: "Widya tidak terjangkau: " + e.message });
    }
  }

  // ---- Widya OCR & Bukti Foto ----
  if ((p === "/api/widya/extract" || p === "/api/dewi/extract") && req.method === "POST") {
    const b = await readBody(req);
    let img = String(b.image || "");
    if (!img) return json(res, 400, { error: "image (base64) required" });
    if (img.startsWith("data:")) img = img.split(",")[1];
    if (img.length > 8_000_000) return json(res, 400, { error: "gambar terlalu besar (maks ~6MB)" });

    let receiptUrl = null;
    try {
      const filename = `evidence-${Date.now()}-${uid().slice(0, 6)}.jpg`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(img, "base64"));
      receiptUrl = `/uploads/receipts/${filename}`;
    } catch (err) {
      console.error("[save-receipt]", err.message);
    }

    const prompt = `Ekstrak data nota/kuitansi berikut menjadi JSON SAJA (tanpa teks lain).
Format tepat:
{"merchant":"nama toko","date":"YYYY-MM-DD","amount":angka_rupiah_tanpa_titik,"items":[{"name":"nama barang","qty":jumlah,"price":harga_satuan}],"payment_method":"CASH_DRAWER|QRIS|BANK_TRANSFER","account_id":"5101|5102|5310|5120|5400|4101"}
Aturan:
- amount = TOTAL belanja (integer rupiah).
- payment_method: tebak dari bukti (BCA/transfer=BANK_TRANSFER, QRIS=QRIS, tunai/kas=CASH_DRAWER), default BANK_TRANSFER.
- account_id: chemical/supplies/bahan=5101, listrik/air/utilitas=5102, servis/kerusakan/maintenance=5310, amenities/hotel=5120, operasional/lapangan=5400, pendapatan/setoran=4101.
- Jika tidak terbaca, isi dengan nilai kosong/0 yang wajar. JANGAN mengarang total yang tidak ada di gambar.`;

    try {
      const upstream = await fetch(`${KARA_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KARA_KEY}` },
        body: JSON.stringify({
          model: KARA_MODEL,
          stream: false,
          temperature: 0,
          max_tokens: 800,
          messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64," + img } }
          ] }]
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!upstream.ok) {
        const txt = await upstream.text().catch(() => "");
        console.error("[extract] upstream", upstream.status, txt.slice(0, 300));
        return json(res, 502, { error: "OCR upstream " + upstream.status, receipt_key: receiptUrl });
      }
      const data = await upstream.json();
      let content = data?.choices?.[0]?.message?.content || "";
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return json(res, 502, { error: "OCR tidak mengembalikan JSON", raw: content.slice(0, 200), receipt_key: receiptUrl });
      let parsed;
      try { parsed = JSON.parse(m[0]); } catch (e) {
        return json(res, 502, { error: "JSON OCR tidak valid", raw: m[0].slice(0, 200), receipt_key: receiptUrl });
      }
      const amount = parseInt(parsed.amount, 10);
      parsed.amount = Number.isInteger(amount) && amount > 0 ? amount : 0;
      if (!Array.isArray(parsed.items)) parsed.items = [];
      if (!["CASH_DRAWER","QRIS","BANK_TRANSFER"].includes(parsed.payment_method)) parsed.payment_method = "BANK_TRANSFER";
      if (!["5101","5102","5310","5120","5400","4101"].includes(String(parsed.account_id))) parsed.account_id = "5101";
      parsed.receipt_key = receiptUrl;
      return json(res, 200, parsed);
    } catch (e) {
      console.error("[extract]", e.message);
      return json(res, 502, { error: "OCR tidak terjangkau: " + e.message, receipt_key: receiptUrl });
    }
  }

  // ---- static files (uploads / foto bukti nota/kerusakan/stock) ----
  if (p.startsWith("/uploads/")) {
    const safePath = path.join(PUBLIC_DIR, path.normalize(p));
    if (fs.existsSync(safePath) && safePath.startsWith(PUBLIC_DIR)) {
      const ext = path.extname(safePath).toLowerCase();
      const ct = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": ct, "Cache-Control": "public, max-age=86400" });
      return fs.createReadStream(safePath).pipe(res);
    }
    return json(res, 404, { error: "file not found" });
  }

  // ---- static: sajikan frontend ----
  if (p === "/" || p === "/index.html") {
    if (!fs.existsSync(HTML_PATH)) return json(res, 404, { error: "frontend belum di-copy" });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(HTML_PATH).pipe(res);
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[sipeka] API + frontend di http://localhost:${PORT}`);
  console.log(`[sipeka] Widya model: ${KARA_MODEL}`);
  console.log(`[sipeka] login: owner/3-staff, password sama: ${DEMO_PASSWORD}`);
});
