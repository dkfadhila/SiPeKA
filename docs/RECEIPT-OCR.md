# Receipt OCR: local suggestions only

Implementation: `receipt-ocr.js`, disposable `receipt-ocr-worker.js`. No ledger/approval mutations. No receipt uploads to third parties. Engine is real Tesseract WASM through tesseract.js, packaged offline English Latin-script data (Indonesian labels parsed locally). No paid API, keys, system Tesseract, CDN or runtime model downloads. English model is not an Indonesian-language accuracy certification. Handwriting, poor photos, unfamiliar date/currency layouts can require entirely manual entry.

## Parent integration (NOT applied to shared files)

Dependencies, after parent review: `tesseract.js@6.0.1 sharp@0.34.5 @tesseract.js-data/eng@1.0.0`. Add exact versions through the existing package manifest and regenerate lockfile during integration; this child changed neither. Install currently exists only under artifact `runtime/`. Production Linux install needs the compatible Sharp optional native packages and tesseract.js-core WASM files. Ship `eng.traineddata.gz` supplied by the language package; missing assets fail closed. Do not point langPath at URLs. Node >=20; VPS read-only probe found Node v24.21.0, no tesseract CLI, approximately 2.3 GB available RAM and 46 GB disk. No production installation/restart occurred.

### server.js

Instantiate exactly one service per HTTP process, after storage import:

```js
const { createReceiptOCR } = require('./receipt-ocr');
const receiptOCR = createReceiptOCR({
  lookupReceipt: filename => q.receiptByFilename.get(filename),
  readReceipt,
});
```

Within existing authenticated API dispatcher, after Origin/CSRF/session enforcement, BEFORE the generic `/api/receipts/` GET block, add POST-only route. No arbitrary URL, filename, image, branch or actor body parameters:

```js
if (p === '/api/receipts/ocr' && req.method === 'POST') {
  const b = await readBody(req); // normal small JSON limit, not image limit
  if (!b || Object.keys(b).length !== 1 || typeof b.receipt_key !== 'string')
    return json(res, 400, { error: 'OCR_INVALID_KEY' });
  try {
    const result = await receiptOCR.extract({ actor: me, receiptKey: b.receipt_key });
    // Revalidate session and current ownership/assigned branch after recognition.
    const current = await auth(req);
    if (!current || current.id !== me.id || current.role !== me.role ||
        current.assigned_branch_id !== me.assigned_branch_id)
      return json(res, 401, { error: 'Sesi berakhir' });
    const asset = await q.receiptByFilename.get(receiptFilename(b.receipt_key));
    if (!asset || !canAccessReceipt(current, asset))
      return json(res, 403, { error: 'OCR_FORBIDDEN' });
    res.setHeader('Cache-Control', 'no-store');
    return json(res, 200, result);
  } catch (e) {
    const safe = /^OCR_[A-Z_]+$/.test(e.code || '');
    return json(res, safe ? e.status : 503, {
      error: safe ? e.code : 'OCR_ENGINE_UNAVAILABLE',
      receipt_key: b.receipt_key,
    });
  }
}
```

Remove historical KARA Vision extraction block (current `/api/widya/extract`, `/api/dewi/extract`) entirely; do not leave a paid/external fallback. Preserve `/api/receipts/upload` validation, storage and receipt metadata writes. Either retire legacy extraction endpoints with explicit 410 manual fallback, or alias them to the same receipt-key-only contract, never image payloads. Existing `tests/server-postgres-http.js` expects legacy 503 with saved image; parent must update HTTP integration tests to two-step upload then OCR, own Staff/same-branch-other-Staff/other-branch/Owner/privacy-revoked-session/Origin cases. Child did not touch that shared test.

### public/financial-dashboard.html

`processReceipt` currently sends base64 to `/api/widya/extract` (around original line 2518). Replace with two calls:

```js
const uploaded = await window.SipekaAuth.api('/api/receipts/upload', {
  method: 'POST', body: {image: dataUrl, branch_id: branchId}
});
if (!receipts.current('scan', upload, img)) return;
window.__lastReceiptKey = receipts.safeReceipt(uploaded.receipt_key);
const res = await window.SipekaAuth.api('/api/receipts/ocr', {
  method: 'POST', body: {receipt_key: window.__lastReceiptKey}
});
if (!receipts.current('scan', upload, img)) return;
```

Keep stored receipt key on OCR failure; do not overwrite it with null in catch. Receipt survives retry/manual entry. Existing compression may damage digits: keep original permitted image within 6 MB where possible, avoid aggressive 0.72 JPEG compression as an accuracy default.

Do NOT reuse old unconditional `set('scAmount', res.amount)` behavior. Display proposed `res.suggestions.amount` (exact decimal string or null), `.date`, `.merchant`, confidence, candidates and warning codes in a dedicated review panel using `textContent`, never `innerHTML`. Label: `Usulan OCR lokal — wajib periksa foto dan konfirmasi`. Ambiguous/missing fields blank, not zero; merchant is a header heuristic, not verified identity. No guessed payment method, account, items or amounts.

Add an explicit unchecked `Saya sudah memeriksa nominal, tanggal, dan toko pada foto` confirmation before applying suggestions to editable fields. Reset review state on new upload, logout, branch/receipt change, new extraction, form rebuild; bind to receipt key + upload generation + user/session generation. Applying proposed fields never submits/approves a transaction. Existing explicit Staff submit and Owner review workflow remains authoritative. Check confirmation in scan-save handler; preserve existing exact integer validation and Owner approval policies. OCR date is a receipt suggestion, not permission to backdate ledger events. Advance line integration optional: display suggestions beside receipt, explicit apply to line only, never mutate advance principal or approved expense.

Replace `dikirim ke Widya Vision` / `EXTRACTED` claims with `OCR lokal; belum dikonfirmasi`, show warnings instead of success certainty. Session generation guard in api currently covers `/api/widya` and `/api/payroll`; extend it to `/api/receipts/ocr`. Continue receipt-specific generation checks. No 2FA changes.

## Bounds and trust boundary

- Server supplies authenticated actor only. OWNER any registered receipt; STAFF own user plus currently assigned branch. All others denied before private read. Matching registry filename required.
- Canonical `/api/receipts/evidence-<digits>-<six lowercase hex>.(jpg|png|webp|gif)` only. URL/query/encoded/path traversal rejected. PDF upload is not supported today; OCR rejects PDF explicitly (415), no renderer.
- 6,000,000 bytes; MIME signature plus actual Sharp decoder; maximum 12 million source pixels; only single-frame images. Animated GIF/WebP rejected rather than silently selecting a frame.
- One active request, no queue, 6 requests/user/minute, bounded 10,000-entry rate map. In-process bounds require shared gateway rate limits/global worker budget if multiple server processes are deployed.
- Entire metadata/read/decode/recognition deadline 30 s; separate forked process killed on timeout/success/error. Child JS heap 256 MB, Sharp threads 1, decoded image resized within 2200x2200. WASM/native memory lies outside JS heap; enforce systemd/cgroup process memory/CPU limits during parent deployment review (not done by child). No shell or command interpolation, worker path fixed.
- Existing storage adapter buffers R2 content before checking its limit. Parent should add bounded streaming/ContentLength + AbortSignal and filesystem pre-read size checks; OCR bounds do not retroactively prevent adapter allocation. A timed-out storage promise cannot be cancelled by this module, but cannot spawn a late worker. Pass only trusted existing private storage adapter, never client URL fetch.
- Raw OCR text untrusted; JSON response with `no-store`; DOM sinks `textContent` or `.value` only. Never log receipt image/text or include it in error diagnostics.
- Exact IDR supports integer digits, Indonesian grouped thousands, optional `,00`; rejects fractional/foreign style/unsafe (>9007199254740991)/zero/leading-zero/O-for-zero. TOTAL labels only; no summing items or using cash/change. Conflicting totals or invalid total => null. Dates full-year DD/MM/YYYY or YYYY-MM-DD, valid calendar only; multiple dates => null. No year guessing. Confidence is engine score, not calibrated financial certainty; review always mandatory.

## Reproducible tests

Local isolated runtime (not repo dependencies):

```sh
NODE_PATH=D:/FamilyAgent/Flora/generated/sipeka-completion/receipt-ocr/runtime/node_modules \
OCR_ARTIFACT_DIR=D:/FamilyAgent/Flora/generated/sipeka-completion/receipt-ocr \
node --test tests/receipt-ocr.test.js tests/receipt-ocr-real.test.js
```

After integrated dependency installation, omit NODE_PATH; set OCR_ARTIFACT_DIR to private scratch outside repo. Tests generate clearly labeled SYNTHETIC fixtures via Sharp, run actual offline engine, preserve extracted results. Covers PNG/JPEG/WebP/GIF, exact 125000 IDR, date/merchant, conflicting totals, invalid date, corrupt decoder input, oversized dimensions/bytes, user/branch authorization, traversal, PDF, timeout/concurrency/rate. These are module-level real-engine tests, not deployed HTTP/browser acceptance. Parent still owes authenticated HTTP/UI review-confirmation tests before release. No commit/push/deploy/production financial writes.
