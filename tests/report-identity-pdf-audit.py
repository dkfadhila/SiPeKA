from pathlib import Path
import json
import fitz
root=Path(__file__).resolve().parents[1]/'report-artifacts';results=[]
for path in sorted(root.glob('*.pdf')):
 doc=fitz.open(path);text='\n'.join(p.get_text() for p in doc)
 assert 'DEVICE QA COMPANY' in text,path.name
 assert 'Unit A' in text,path.name
 for page in doc:
  assert 'DEVICE QA COMPANY' in page.get_text(),(path.name,page.number,'missing repeated company')
  for word in page.get_text('words'):
   assert -1<=word[0]<word[2]<=page.rect.width+1 and -1<=word[1]<word[3]<=page.rect.height+1,(path.name,page.number,word)
 if path.stem in ['fund-position','recorded-income-expense']:
  assert 'Belum tersedia' in text,path.name
  assert 'snapshot' in text.lower(),path.name
 results.append({'file':path.name,'pages':len(doc),'text_bounds':'pass'})
assert len(results)==9
(root/'pdf-proof.json').write_text(json.dumps(results,indent=2));print(json.dumps({'pdf_documents':len(results),'pages':sum(x['pages'] for x in results),'passed':True}))
