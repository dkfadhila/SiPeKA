'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const upload=require('../payroll-upload'),payroll=require('../employee-payroll');
const employee={id:'HO-26002',name:'Ayu Contoh',department:'Operasional',branch_id:'ho',branch_name:'Head Office',active:true,revision:1,email:'ayu@example.test'};
const text=(patch={})=>`CV Artha Multi Ciptanusa\nNama Karyawan : ${patch.name??employee.name}\nID Karyawan : ${patch.id??employee.id}\nPeriode : ${patch.period??'2026-10'}\n${patch.email===null?'':`Email : ${patch.email??employee.email}`}\nGaji pokok : Rp 3.000.000\n`;
const csv=(period='2026-10',email)=>payroll.FULL_GENERAL_HEADER+(email===undefined?'':',email')+'\r\n'+[period,employee.id,'3000000','250000','100000','200000','150000','50000','25000','0','0','Admin','Tetap','Transfer',...(email===undefined?[]:[email])].join(',')+'\r\n';
function salaryRow(period='2026-10'){return {...employee,employee_id:employee.id,full_name:employee.name,period,company_name:'CV Artha Multi Ciptanusa',company_address:'Alamat Contoh',basic_salary:3000000,operational_allowance:250000,health_allowance:100000,overtime:200000,bonus:150000,allowances:700000,absence_deduction:50000,late_deduction:25000,violation_deduction:0,deductions:75000,pph21:0,net_salary:3625000};}
function syntheticPdf({pages=1,active=false,empty=false}={}){
 const literal=v=>v.replace(/([\\()])/g,'\\$1');
 const contents=empty?'':text().split('\n').map((line,i)=>`BT /F1 11 Tf 40 ${780-i*20} Td (${literal(line)}) Tj ET`).join('\n');
 const objects=[`<< /Type /Catalog /Pages 2 0 R${active?' /OpenAction 7 0 R':''} >>`,`<< /Type /Pages /Kids [3 0 R${pages>1?' 6 0 R':''}] /Count ${pages} >>`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Action /S /JavaScript /JS (throw new Error\\(\\"must not execute\\"\\)) >>'];
 const parts=[Buffer.from('%PDF-1.4\n')],offsets=[0];let at=parts[0].length;
 for(const [i,value]of objects.entries()){offsets.push(at);const part=Buffer.from(`${i+1} 0 obj\n${value}\nendobj\n`);parts.push(part);at+=part.length;}
 parts.push(Buffer.from('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`));return Buffer.concat(parts);
}

test('PDF matching requires one current employee and period; missing, ambiguous or different email cannot route silently',()=>{
 const matched=upload.matchPdf(text(),[employee],'2026-10');assert.equal(matched.email,employee.email);assert.deepEqual(matched.warnings,[]);assert.deepEqual(matched.blockers,[]);
 const fallback=upload.matchPdf(text({email:null}),[employee],'2026-10');assert.equal(fallback.email,employee.email);assert.deepEqual(fallback.warnings,['PAYROLL_PDF_EMAIL_MISSING_REVIEW']);assert.deepEqual(fallback.blockers,[]);
 assert.ok(upload.matchPdf(text({email:null}),[{...employee,email:null}],'2026-10').blockers.includes('PAYROLL_EMAIL_MISSING'));
 assert.ok(upload.matchPdf(text(),[employee,{...employee,id:'RD-26003',name:'Budi Contoh'}],'2026-10').blockers.includes('PAYROLL_EMAIL_AMBIGUOUS'));
 assert.ok(upload.matchPdf(text({email:'wrong@example.test'}),[employee],'2026-10').blockers.includes('PAYROLL_PDF_EMAIL_MISMATCH'));
 assert.ok(upload.matchPdf(text()+'Finance: finance@example.test\n',[employee],'2026-10').blockers.includes('PAYROLL_PDF_EMAIL_MISMATCH'));
 const salaryLooksLikeId=upload.matchPdf(text()+'Total pendapatan: Rp 1.001\n',[employee,{...employee,id:'001',name:'Other Employee',email:'other@example.test'}],'2026-10');assert.equal(salaryLooksLikeId.employee.id,employee.id);assert.deepEqual(salaryLooksLikeId.blockers,[]);
 for(const [source,staff,period,code]of [
  [text({name:'Budi Contoh'}),[employee],'2026-10','PAYROLL_PDF_IDENTITY_MISMATCH'],
  [text({id:'OTHER'}),[employee],'2026-10','PAYROLL_STAFF_NOT_FOUND'],
  [text(),[{...employee,active:false}],'2026-10','PAYROLL_STAFF_NOT_FOUND'],
  [text(),[{...employee,department:null}],'2026-10','PAYROLL_EMPLOYEE_DEPARTMENT_REQUIRED'],
  [text({period:'2026-09'}),[employee],'2026-10','PAYROLL_PDF_PERIOD_MISMATCH'],
  [text()+text(),[employee],'2026-10','PAYROLL_PDF_IDENTITY_REQUIRED'],
  [text().replace('ID Karyawan : HO-26002',''),[employee],'2026-10','PAYROLL_PDF_IDENTITY_REQUIRED'],
  [text(),[employee],'2026-13','PAYROLL_PERIOD'],
 ])assert.throws(()=>upload.matchPdf(source,staff,period),new RegExp(code));
});

test('review token binds session, source/master fingerprint, signature and ten-minute expiry',()=>{
 const key='ab'.repeat(32),digest=upload.fingerprint({source:'pdf A',employee});
 const token=upload.reviewToken(key,'owner-session-a',digest);assert.doesNotThrow(()=>upload.verifyToken(key,'owner-session-a',digest,token));
 for(const [session,d,t]of [['owner-session-b',digest,token],['owner-session-a',upload.fingerprint({source:'pdf B',employee}),token],['owner-session-a',digest,token+'.extra'],['owner-session-a',digest,token.slice(0,-1)+(token.endsWith('a')?'b':'a')],['owner-session-a',digest,upload.reviewToken(key,'owner-session-a',digest,Date.now()-1)]])assert.throws(()=>upload.verifyToken(key,session,d,t),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
 assert.throws(()=>upload.reviewToken('', 'owner-session-a',digest),/PAYROLL_ENCRYPTION_KEY_REQUIRED/);
});

test('CSV source email is optional but cannot override master or salary arithmetic',()=>{
 const expected=payroll.validate(csv(),[employee])[0];assert.equal(expected.net_salary,3625000);assert.equal(expected.email,employee.email);
 const withEmail=payroll.validate(csv('2026-10','AYU@example.test'),[employee])[0];assert.equal(withEmail.net_salary,expected.net_salary);assert.equal(withEmail.source_email,employee.email);assert.equal(withEmail.staff_revision,1);
 assert.equal(payroll.validate(csv('2026-10',''),[employee])[0].email,employee.email);
 assert.throws(()=>payroll.validate(csv('2026-10','wrong@example.test'),[employee]),/PAYROLL_PDF_EMAIL_MISMATCH/);
 assert.throws(()=>payroll.validate(csv('2026-10','invalid'),[employee]),/PAYROLL_EMAIL_INVALID/);
 assert.throws(()=>payroll.validate(csv().replace('3000000','=3000000'),[employee]),/PAYROLL_CSV_CELL/);
});

test('real exported slip is extracted in disposable PDF worker and still needs absent-email review',async()=>{
 const bytes=require('../payroll-pdf').renderSlipPdf(salaryRow(),{documentIdentity:{company_name:'CV Artha Multi Ciptanusa',company_address:'Alamat Contoh',branch_name:'Head Office'}}),encoded=bytes.toString('base64');
 assert.deepEqual(upload.pdfBytes(encoded),bytes);
 const extracted=await upload.extractPdf(encoded),match=upload.matchPdf(extracted,[employee],'2026-10');
 assert.match(extracted,/Ayu Contoh/);assert.match(extracted,/3\.625\.000/);assert.equal(match.employee.id,employee.id);assert.equal(match.email,employee.email);assert.deepEqual(match.warnings,['PAYROLL_PDF_EMAIL_MISSING_REVIEW']);
 for(const value of ['',Buffer.from('not a pdf').toString('base64'),encoded+'!',Buffer.alloc(upload.MAX_PDF+1).toString('base64')])assert.throws(()=>upload.pdfBytes(value),/PAYROLL_PDF_INVALID/);
 await assert.rejects(upload.extractPdf(Buffer.from('%PDF-1.4\nnot a real document\n%%EOF').toString('base64')),/PAYROLL_PDF_INVALID/);
});

test('PDF reader rejects executable actions, multiple slips/pages and scans without searchable text',async()=>{
 const clean=await upload.extractPdf(syntheticPdf().toString('base64'));assert.equal(upload.matchPdf(clean,[employee],'2026-10').email,employee.email);
 for(const [options,code]of [[{active:true},'PAYROLL_PDF_ACTIVE_CONTENT'],[{pages:2},'PAYROLL_PDF_SINGLE_SLIP'],[{empty:true},'PAYROLL_PDF_TEXT_REQUIRED']])await assert.rejects(upload.extractPdf(syntheticPdf(options).toString('base64')),new RegExp(code));
});

const pglitePath=process.env.PAYROLL_TEST_PGLITE||process.env.REPORTS_TEST_PGLITE;
test('real isolated PostgreSQL procedures preserve original PDF, encryption, publication, recipient fencing and send idempotency',{skip:!pglitePath,timeout:90000},async t=>{
 const {PGlite}=require(pglitePath),db=new PGlite();t.after(()=>db.close());
 const run=async(sql,params)=>{const result=!params&&sql.includes(';')?(await db.exec(sql)).at(-1):await db.query(sql,params);return {...result,rowCount:result.rows.length||result.affectedRows||0};};
 let mutex=Promise.resolve();const acquire=async()=>{const prior=mutex;let release;mutex=new Promise(r=>release=r);await prior;return release;};
 const pool={async query(sql,params){const release=await acquire();try{return await run(sql,params);}finally{release();}},async connect(){const release=await acquire();return {query:run,release};}};
 await require('../migrations/runner').migrate(pool);
 await pool.query(`INSERT INTO business_units(id,code,name,category) VALUES('ho','AMC','Head Office','LAUNDRY');
 INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','qa_owner','unused','Owner QA','OWNER',NULL),('device','qa_device','unused','Device QA','STAFF','ho');
 INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('owner-session','owner',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full'),('staff-session','device',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full');
 INSERT INTO operational_staff(id,name,branch_id,department,email) VALUES('HO-26002','Ayu Contoh','ho','Operasional','ayu@example.test');
 INSERT INTO company_profile(singleton,name,updated_by) VALUES(true,'CV Artha Multi Ciptanusa','owner');`);
 const sent=[],env={PAYROLL_ENCRYPTION_KEY:'ab'.repeat(32),PAYROLL_EMAIL_FROM:'raditya@widyafa.xyz'};
 const widyaReviews=require('../payroll-widya-review').create({sessions:require('./fixtures/payroll-review-offline.cjs').sessions(pool),key:env.PAYROLL_ENCRYPTION_KEY});
 const svc=payroll.service({pool,env,widyaReviews,transport:{async sendMail(mail){sent.push(mail);return {accepted:[mail.to],messageId:'offline-'+sent.length};}}});
 // HTTP admission restricts review to Owner; protected SQL reads/writes enforce the actor too.
 await assert.rejects(svc.list('staff-session'),/PAYROLL_OWNER_ONLY|OPERATIONAL_OWNER_REQUIRED/);
 await pool.query('UPDATE operational_staff SET email=NULL WHERE id=$1',[employee.id]);
 const missingStart=await svc.reviewUpload('owner-session',{format:'csv',csv:csv()});const missingEmail=await svc.reviewStatus('owner-session',missingStart.review_id);assert.equal(missingEmail.review_token,null);assert.deepEqual(missingEmail.blockers,['PAYROLL_EMAIL_MISSING']);
 await assert.rejects(svc.importUpload('owner-session',{format:'csv',csv:csv(),confirmed:true,review_token:'none'}),/PAYROLL_EMAIL_MISSING/);
 await assert.rejects(svc.importCsv('owner-session',csv()),/PAYROLL_EMAIL_MISSING/);
 assert.equal((await pool.query('SELECT count(*)::integer n FROM payroll_batches')).rows[0].n,0);
 await pool.query('UPDATE operational_staff SET email=$2 WHERE id=$1',[employee.id,employee.email]);
 const bytes=require('../payroll-pdf').renderSlipPdf(salaryRow(),{documentIdentity:{company_name:'CV Artha Multi Ciptanusa',company_address:'Alamat Contoh',branch_name:'Head Office'}});
 const body={format:'pdf',period:'2026-10',data_base64:bytes.toString('base64'),company_address:'Alamat Contoh'};
 const reviewStart=await svc.reviewUpload('owner-session',body);assert.equal(reviewStart.review_token,null);const review=await svc.reviewStatus('owner-session',reviewStart.review_id);assert.ok(review.review_token);assert.deepEqual(review.warnings,['PAYROLL_PDF_EMAIL_MISSING_REVIEW']);assert.equal(review.rows[0].source_pdf,undefined);assert.equal(sent.length,0);
 await assert.rejects(svc.importUpload('owner-session',{...body,review_id:review.review_id,review_token:review.review_token,confirmed:false}),/PAYROLL_CONFIRM_REQUIRED/);
 await assert.rejects(svc.importUpload('owner-session',{...body,review_token:review.review_token,confirmed:true}),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
 const hold=payroll.service({pool,env,widyaReviews:{start:widyaReviews.start,async status(token,id){return {...await widyaReviews.status(token,id),ai:{decision:'TAHAN',text:'Perhitungan perlu diperiksa'}};}}});
 await assert.rejects(hold.importUpload('owner-session',{...body,review_id:review.review_id,review_token:review.review_token,confirmed:true}),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
 const restart=payroll.service({pool,env,widyaReviews:require('../payroll-widya-review').create({sessions:require('./fixtures/payroll-review-offline.cjs').sessions(pool),key:env.PAYROLL_ENCRYPTION_KEY})});
 const persisted=await restart.reviewStatus('owner-session',review.review_id);assert.equal(persisted.ai.decision,'LANJUT');assert.ok(persisted.review_token);
 await assert.rejects(svc.importUpload('owner-session',{...body,company_address:'Changed',review_id:review.review_id,review_token:review.review_token,confirmed:true}),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
 const imported=await svc.importUpload('owner-session',{...body,review_id:review.review_id,review_token:review.review_token,confirmed:true});assert.equal(imported.status,'DRAFT');
 const first=(await svc.list('owner-session')).rows[0];assert.equal(first.row.upload_kind,'PDF');assert.equal(first.row.source_pdf,undefined);assert.equal(first.recipient_valid,true);assert.deepEqual(await svc.pdf('owner-session',first.id),bytes);
 const storage=(await pool.query('SELECT payload_cipher FROM payroll_entries WHERE id=$1',[first.id])).rows[0].payload_cipher;assert.ok(storage.startsWith('v1.'));assert.ok(!storage.includes(employee.email));assert.ok(!storage.includes(body.data_base64.slice(0,100)));
 await assert.rejects(svc.importUpload('owner-session',{...body,review_id:review.review_id,review_token:review.review_token,confirmed:true}),e=>e.code==='23505'||/PAYROLL_DUPLICATE_PERIOD_STAFF/.test(e.message));
 assert.equal((await pool.query('SELECT count(*)::integer n FROM payroll_batches')).rows[0].n,1);
 await assert.rejects(svc.send('owner-session',first.id,{email:employee.email,confirmed:true}),/PAYROLL_NOT_PUBLISHED/);
 await assert.rejects(svc.publish('owner-session',{id:imported.id,preview_token:'wrong',confirmed:true}),/PAYROLL_PREVIEW_TOKEN/);
 await svc.publish('owner-session',{id:imported.id,preview_token:first.preview_token,confirmed:true});
 await assert.rejects(svc.send('owner-session',first.id,{email:'wrong@example.test',confirmed:true}),/PAYROLL_CONTACT_CHANGED/);
 await assert.rejects(svc.send('owner-session',first.id,{email:employee.email,confirmed:false}),/PAYROLL_CONFIRM_REQUIRED/);
 assert.equal(sent.length,0);
 const deliveries=await Promise.all([svc.send('owner-session',first.id,{email:employee.email,confirmed:true}),svc.send('owner-session',first.id,{email:employee.email,confirmed:true})]);assert.ok(deliveries.some(r=>r.status==='sent'));assert.ok(deliveries.every(r=>['sent','sending'].includes(r.status)));assert.equal(sent.length,1);assert.equal(sent[0].to,employee.email);assert.equal(sent[0].attachments.length,2);assert.equal(sent[0].attachments[1].cid,'amc-payroll-header');assert.deepEqual(sent[0].attachments[0].content,bytes);assert.equal(sent[0].attachments[0].contentType,'application/pdf');
 const repeated=await svc.send('owner-session',first.id,{email:employee.email,confirmed:true});assert.equal(repeated.status,'sent');assert.equal(sent.length,1);
 const secondStart=await svc.reviewUpload('owner-session',{format:'csv',csv:csv('2026-11')});const secondReview=await svc.reviewStatus('owner-session',secondStart.review_id);
 const secondImport=await svc.importUpload('owner-session',{format:'csv',csv:csv('2026-11'),review_id:secondReview.review_id,review_token:secondReview.review_token,confirmed:true});
 const second=(await svc.list('owner-session')).rows.find(e=>e.batch_id===secondImport.id);assert.equal(second.row.net_salary,3625000);await svc.publish('owner-session',{id:secondImport.id,preview_token:second.preview_token,confirmed:true});
 let unknownCalls=0;const uncertain=payroll.service({pool,env,transport:{async sendMail(){unknownCalls++;throw Error('offline-provider-timeout');}}});
 assert.equal((await uncertain.send('owner-session',second.id,{email:employee.email,confirmed:true})).status,'uncertain');assert.equal((await uncertain.send('owner-session',second.id,{email:employee.email,confirmed:true})).status,'uncertain');assert.equal(unknownCalls,1);
 const thirdStart=await svc.reviewUpload('owner-session',{format:'csv',csv:csv('2026-12')});const thirdReview=await svc.reviewStatus('owner-session',thirdStart.review_id);
 await pool.query("UPDATE operational_staff SET revision=revision+1,email='ayu-new@example.test' WHERE id=$1",[employee.id]);
 await assert.rejects(svc.importUpload('owner-session',{format:'csv',csv:csv('2026-12'),review_id:thirdReview.review_id,review_token:thirdReview.review_token,confirmed:true}),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
 assert.equal((await svc.list('owner-session')).rows.find(e=>e.id===first.id).recipient_valid,false);
 await assert.rejects(svc.send('owner-session',first.id,{email:employee.email,confirmed:true}),/PAYROLL_CONTACT_CHANGED/);assert.equal(sent.length,1);
});
