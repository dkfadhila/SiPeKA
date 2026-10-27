import importlib.util,unittest,tempfile,uuid,json,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('sender','scripts/widya-telegram-send.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Delivery(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.base=Path(self.temp.name).resolve();self.root=self.base/'outputs';self.state=self.base/'receipts';self.sid=str(uuid.uuid4());self.dir=self.root/self.sid/'outputs';self.dir.mkdir(parents=True);self.p={'request_id':str(uuid.uuid4()),'recipient':'tirta','text':'Synthetic offline only','confirmed':True};self.calls=[];self.sessions={'agent:widya:telegram:dm:1122048904':{'origin':{'user_name':'Tirta','chat_id':'1122048904','chat_type':'dm'}}}
 def transport(self,method,payload,file):
  self.calls.append((method,payload,file));return {'id':1122048904,'type':'private'} if method=='getChat' else {'message_id':10,'chat':{'id':1122048904,'type':'private'},**({'caption':payload['caption'],'document':{'file_name':file[0]}} if file else {'text':payload['text']})}
 def send(self,p=None,transport=None):return m.deliver(p or self.p,transport or self.transport,self.sessions,self.state,self.root)
 def test_exact_text_and_idempotency(self):
  r=self.send();self.assertEqual(r['status'],'accepted');self.assertEqual(self.calls[1][1]['text'],self.p['text']);self.assertEqual(self.send()['message_id'],10);self.assertEqual(len(self.calls),2)
  with self.assertRaisesRegex(ValueError,'REQUEST_CONFLICT'):self.send({**self.p,'text':'different'})
 def test_file_exact_bytes(self):
  path=self.dir/'cashflow.pdf';path.write_bytes(b'%PDF-synthetic');self.send({**self.p,'session_id':self.sid,'file':str(path)});self.assertEqual(self.calls[1][0],'sendDocument');self.assertEqual(self.calls[1][2],('cashflow.pdf',b'%PDF-synthetic'))
 def test_mismatched_response_quarantined(self):
  def bad(method,payload,file):return {'id':1122048904,'type':'private'} if method=='getChat' else {'message_id':10,'chat':{'id':1122048904,'type':'private'},'text':'wrong'}
  with self.assertRaisesRegex(ValueError,'UNCERTAIN_DO_NOT_RETRY'):self.send(transport=bad)
  with self.assertRaisesRegex(ValueError,'UNCERTAIN_DO_NOT_RETRY'):self.send()
 def test_missing_confirmation_unknown_route_and_private_dest(self):
  for patch in [{'confirmed':False},{'recipient':'unknown'},{'request_id':'x'},{'text':'x'*4097},{'secret':'x'}]:
   with self.assertRaises(ValueError):self.send({**self.p,**patch})
  self.sessions['agent:widya:telegram:dm:1122048904']['origin']['chat_type']='group'
  with self.assertRaisesRegex(ValueError,'ROUTE_NOT_VERIFIED'):self.send()
  self.assertEqual(self.calls,[])
 def test_uncertain_never_retries(self):
  def transport(method,payload,file):
   self.calls.append(method)
   if method=='getChat':return {'id':1122048904,'type':'private'}
   raise TimeoutError('secret token must not escape')
  with self.assertRaisesRegex(ValueError,'UNCERTAIN_DO_NOT_RETRY'):self.send(transport=transport)
  with self.assertRaisesRegex(ValueError,'UNCERTAIN_DO_NOT_RETRY'):self.send()
  self.assertEqual(len(self.calls),2)
 def test_path_and_payroll_guards(self):
  for file in [str(self.base/'secret.pdf'),str(self.dir/'slip-gaji.pdf'),str(self.dir/'config.env')]:
   with self.assertRaises(ValueError):self.send({**self.p,'file':file,'session_id':self.sid})
  with self.assertRaisesRegex(ValueError,'INVALID_SESSION'):self.send({**self.p,'file':str(self.dir/'x.pdf'),'session_id':'../bad'})
 def test_symlink_rejected(self):
  source=self.dir/'source.pdf';source.write_bytes(b'file');link=self.dir/'linked.pdf'
  try:link.symlink_to(source)
  except OSError:self.skipTest('Host symlink privilege unavailable')
  with self.assertRaisesRegex(ValueError,'INVALID_FILE'):self.send({**self.p,'file':str(link),'session_id':self.sid})
if __name__=='__main__':unittest.main()
