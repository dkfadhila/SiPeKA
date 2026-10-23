# Widya dashboard and Telegram

Open **Widya**, choose **Tambah Sesi**, and send a request. The left side lists conversations stored for the signed-in Owner. Reopening a session continues the same Hermes conversation; refresh, logout and a new login do not delete its stored messages or downloads. Older messages and sessions can be loaded from the list. There is no automatic session deletion.

Use the plus button to attach up to four files, each at most 10 MiB. Ask Widya to inspect an attachment or produce a file. Generated files appear as download links in the reply once Hermes has created them and the server has retained their bytes. **Hentikan** requests cancellation while preserving the conversation. When a tool needs approval, review its action and select **Izinkan sekali** or **Tolak**.

For real dashboard data, the private Telegram bot and dashboard profile can use the installed `sipeka-dashboard-reader` skill. Example requests: “Ringkas pemasukan dan belanja tanggal 1–24 Oktober 2026 untuk semua cabang”, “Tampilkan cabang yang tersedia”, or “Periksa pengajuan yang masih menunggu persetujuan pada periode ini.” Use the intended dates explicitly. Current staff-fund outstanding is a present snapshot, not a historical end balance. Missing cash/assets/liabilities remain unavailable.

Existing legacy browser conversations that were never stored by the old dashboard cannot automatically become new server sessions. This release preserves all messages submitted through the new session API. Unknown upstream admission stops safely for operator review instead of duplicating an agent run; another session can be created while its history remains retained.

Validation is described in `docs/WIDYA_HERMES.md` and `docs/widya/telegram-dashboard-read.md`. Manual actual-Hermes acceptance uses `WIDYA_LIVE_PROBE=1 node tests/widya-hermes-live-vps.cjs` on the VPS. It retains an isolated QA schema, uses a synthetic attachment, checks a generated download and a second-turn memory response, and performs no financial writes or Telegram sends.
