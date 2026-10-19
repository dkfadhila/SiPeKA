/* Plain-language messages for the API contracts used by the financial workspace. */
(()=>{'use strict';
 const messages={
  OPERATIONAL_STALE_SELECTION:'Data sudah berubah. Muat ulang halaman, lalu periksa dan simpan kembali.',
  OPERATIONAL_EMAIL_CONFIRM_REQUIRED:'Periksa email penerima dan centang konfirmasi email sebelum menyimpan.',
  OPERATIONAL_DEPARTMENT_INVALID:'Departemen maksimal 120 karakter tanpa karakter kontrol.',
  OPERATIONAL_INPUT_INVALID:'Periksa nama, unit aktif, dan status karyawan.',
  OPERATIONAL_DEVICE_INVALID:'Device tidak tersedia. Muat ulang daftar device.',
  OPERATIONAL_DEVICE_LABEL_CONFLICT:'Nama device tersebut sudah dipakai di unit ini.',
  PAYROLL_COMPANY_REQUIRED:'Simpan nama perusahaan sebelum mengimpor gaji.',
  PAYROLL_EMPLOYEE_DEPARTMENT_REQUIRED:'Lengkapi departemen karyawan di direktori sebelum mengimpor gaji.',
  PAYROLL_STAFF_NOT_FOUND:'ID karyawan tidak ditemukan atau karyawan sudah nonaktif. Periksa direktori dan file CSV.',
  PAYROLL_DUPLICATE_PERIOD_STAFF:'Karyawan tersebut sudah memiliki slip untuk periode ini. Periksa daftar slip sebelum mengimpor kembali.',
  PAYROLL_PERIOD:'Gunakan satu periode yang sama dengan format YYYY-MM, misalnya 2026-10.',
  PAYROLL_NET_INVALID:'Total potongan melebihi gaji kotor atau nominal melampaui batas. Periksa komponen gaji.',
  PAYROLL_USERNAME:'Isi employee_id menggunakan ID karyawan dari direktori.',
  PAYROLL_ENCRYPTION_KEY_REQUIRED:'Penyimpanan gaji belum siap. Hubungi pengelola.',
  PAYROLL_CSV_LIMIT:'CSV maksimal 1 MB dan 1.000 karyawan; periksa juga panjang isi kolom.',
  PAYROLL_CSV_QUOTE:'Tanda kutip CSV belum benar. Gunakan template dan ekspor ulang sebagai CSV.',
  PAYROLL_PREVIEW_TOKEN:'Preview slip sudah berubah. Muat ulang dan periksa kembali sebelum menerbitkan.',
  PAYROLL_CSV_HEADER:'Kolom CSV belum sesuai. Unduh template gaji terbaru dan gunakan urutan kolomnya.',
  PAYROLL_CSV_ROWS:'Isi baris CSV belum lengkap atau kolomnya tidak sesuai template.',
  PAYROLL_CSV_CELL:'Isi CSV sebagai teks atau angka biasa, tanpa rumus.',
  PAYROLL_INTEGER_IDR:'Nominal gaji harus rupiah bulat, tanpa titik, koma, atau rumus.',
  PAYROLL_CONTACT_CHANGED:'Email karyawan berubah sejak slip diimpor. Pengiriman diblokir; periksa email pada slip dan direktori.',
  PAYROLL_NOT_PUBLISHED:'Periksa dan terbitkan slip sebelum mengirim email.',
  PAYROLL_CONFIRM_REQUIRED:'Centang konfirmasi setelah memeriksa slip dan penerima.',
  PAYROLL_DELIVERY_UNCERTAIN:'Status pengiriman belum dapat dipastikan. Muat ulang status; jangan kirim ulang sebelum diperiksa.',
  PAYROLL_DELIVERY_IN_PROGRESS:'Slip sedang dikirim. Muat ulang status beberapa saat lagi.',
  PAYROLL_UNAVAILABLE:'Data gaji belum tersedia. Muat ulang status atau hubungi pengelola.',
  PAYROLL_DECRYPT_FAILED:'Data slip belum dapat dibaca. Hubungi pengelola sebelum melanjutkan.',
 };
 window.SipekaUi={message:error=>{const code=String(error?.message||error),row=/^PAYROLL_CSV_CELL_(\d+)$/.exec(code);return row?'Periksa baris '+row[1]+' pada CSV. Isi teks atau angka biasa tanpa rumus.':messages[code]||code;}};
})();
