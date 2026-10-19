-- Forward-only additions from the Owner's supplied P&L. Legacy codes/rows stay intact.
INSERT INTO chart_of_accounts(id,account_code,account_name,account_type) VALUES
('4-1100','4-1100','Pendapatan Kamar','REVENUE'),
('4-1200','4-1200','Pendapatan Sewa','REVENUE'),
('4-1300','4-1300','Pendapatan Jasa Laundry','REVENUE'),
('4-1400','4-1400','Penjualan','REVENUE'),
('4-1900','4-1900','Pendapatan Usaha Lainnya','REVENUE'),
('5-1100','5-1100','Bahan Habis Pakai (Amenities, Deterjen, Kimia)','EXPENSE'),
('5-1200','5-1200','Pakan & Obat Ikan','EXPENSE'),
('5-1300','5-1300','Bibit','EXPENSE'),
('5-1400','5-1400','Upah Langsung (Housekeeping, Operator, Pembudidaya)','EXPENSE'),
('5-1500','5-1500','Utilitas Produksi (Listrik, Air, Gas)','EXPENSE'),
('6-1100','6-1100','Gaji & Upah (Non-Produksi)','EXPENSE'),
('6-1200','6-1200','Komisi OTA & Platform','EXPENSE'),
('6-1300','6-1300','Pemasaran & Promosi','EXPENSE'),
('6-1400','6-1400','Listrik, Air & Internet (Umum)','EXPENSE'),
('6-1500','6-1500','Perawatan & Perbaikan','EXPENSE'),
('6-1600','6-1600','Sewa','EXPENSE'),
('6-1700','6-1700','Transportasi & BBM','EXPENSE'),
('6-1800','6-1800','Pajak, Perizinan & Retribusi','EXPENSE'),
('6-1900','6-1900','Administrasi, Bank & Perlengkapan Kantor','EXPENSE'),
('6-2000','6-2000','Beban Usaha Lainnya','EXPENSE'),
('6-3000','6-3000','Beban Penyusutan','EXPENSE'),
('7-1100','7-1100','Pendapatan Bunga & Pendapatan Lain-lain','REVENUE'),
('7-2100','7-2100','Beban Bunga & Beban Lain-lain','EXPENSE'),
('8-1000','8-1000','Beban Pajak Penghasilan (PPh Final)','EXPENSE');
-- Explicit category definitions only; funds/posting still require Owner review.
INSERT INTO accounting_accounts(id,code,name,type)
 SELECT 'coa_'||id,account_code,account_name,account_type FROM chart_of_accounts
 WHERE id IN ('4-1100','4-1200','4-1300','4-1400','4-1900','5-1100','5-1200','5-1300','5-1400','5-1500','6-1100','6-1200','6-1300','6-1400','6-1500','6-1600','6-1700','6-1800','6-1900','6-2000','6-3000','7-1100','7-2100','8-1000');
INSERT INTO accounting_category_maps(coa_id,account_id)
 SELECT c.id,a.id FROM chart_of_accounts c JOIN accounting_accounts a ON a.id='coa_'||c.id;
CREATE FUNCTION cash_coa_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM chart_of_accounts WHERE id=NEW.coa_id AND account_code='6-3000') THEN
  RAISE EXCEPTION 'NONCASH_ACCOUNT_NOT_ALLOWED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cash_coa_ledger BEFORE INSERT ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION cash_coa_guard();
CREATE TRIGGER cash_coa_settlement BEFORE INSERT ON advance_settlement_lines FOR EACH ROW EXECUTE FUNCTION cash_coa_guard();
