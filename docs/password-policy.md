# Password baru

Minimum 6 karakter; minimal satu huruf besar ASCII A-Z; maksimum 1024 karakter. Angka dan simbol tidak wajib. Password lebih panjang dan beberapa huruf besar diperbolehkan.

Berlaku untuk pembuatan pengguna, reset oleh Owner, perubahan sendiri, forced setup, dan seed SQLite. Backend memakai `auth-security.validateNewPassword`; hashing Argon2id tetap. Login dan rehash kredensial lama tidak menerapkan kebijakan baru; akun/sesi existing tidak direset saat perubahan source ini.

Pengurangan minimum 12 menjadi 6 melemahkan ketahanan terhadap tebakan. Origin, RBAC, rate limit, forced setup, verifikasi password lama, pencabutan sesi setelah perubahan/reset tetap berlaku.

Candidate saja; belum commit/push/deploy. Uji VPS isolated schema; tidak menulis bisnis production atau memanggil provider nyata.
