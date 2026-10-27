#!/usr/bin/env python3
"""Private Widya Owner-requested delivery. One JSON argument; no automatic retries."""
import hashlib,json,os,re,sys,uuid,urllib.request
from pathlib import Path
PROFILE=Path('/home/ubuntu/.hermes/profiles/widya')
SESSIONS=Path('/home/ubuntu/.hermes/sessions/sessions.json')
OUTPUTS=Path('/var/lib/sipeka/widya-files')
STATE=Path('/home/ubuntu/FamilyAgent/Widya/generated/telegram-delivery-receipts')
RECIPIENTS={'radit':(1263563064,'Raditya Martanegara'),'tirta':(1122048904,'Tirta')}
def fail(code):raise ValueError('WIDYA_TELEGRAM_'+code)
def validate(p):
 if not isinstance(p,dict) or set(p)-{'request_id','recipient','text','confirmed','file','session_id'}:fail('INVALID_REQUEST')
 if p.get('confirmed') is not True:fail('EXPLICIT_REQUEST_REQUIRED')
 if p.get('recipient') not in RECIPIENTS:fail('RECIPIENT_NOT_ALLOWED')
 if not isinstance(p.get('text'),str) or not p['text'].strip() or len(p['text'])>4096:fail('INVALID_TEXT')
 try:
  if str(uuid.UUID(p['request_id']))!=p['request_id']:fail('INVALID_REQUEST_ID')
 except (ValueError,TypeError,KeyError,AttributeError):fail('INVALID_REQUEST_ID')
 if p.get('file') and len(p['text'])>1024:fail('CAPTION_TOO_LONG')
 if p.get('session_id') and not p.get('file'):fail('INVALID_REQUEST')
 return p

def attachment(p,root=OUTPUTS):
 if not p.get('file'):return None
 sid=p.get('session_id')
 try:
  if str(uuid.UUID(sid))!=sid:fail('INVALID_SESSION')
 except (ValueError,TypeError,AttributeError):fail('INVALID_SESSION')
 file=Path(p['file']);expected=root/sid/'outputs'
 if not file.is_absolute() or file.parent!=expected or file.name in ('.','..'):fail('INVALID_FILE')
 if re.search(r'(slip|gaji|payroll)',file.name,re.I):fail('PAYROLL_USE_PRIVATE_WORKFLOW')
 for part in [root,root/sid,expected,file]:
  if part.is_symlink() or part.resolve()!=part:fail('INVALID_FILE')
 if file.suffix.lower() not in {'.pdf','.csv','.xlsx','.txt','.png','.jpg','.jpeg'}:fail('INVALID_FILE')
 fd=os.open(file,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
 try:
  st=os.fstat(fd)
  import stat
  if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_size<1 or st.st_size>10*1024*1024:fail('INVALID_FILE')
  with os.fdopen(fd,'rb',closefd=False) as stream:data=stream.read(10*1024*1024+1)
 finally:os.close(fd)
 if len(data)!=st.st_size:fail('FILE_CHANGED')
 return file.name,data

def route(p,sessions):
 chat,name=RECIPIENTS[p['recipient']]
 origin=sessions.get('agent:widya:telegram:dm:'+str(chat),{}).get('origin',{})
 if origin.get('user_name')!=name or str(origin.get('chat_id'))!=str(chat) or origin.get('chat_type')!='dm':fail('ROUTE_NOT_VERIFIED')
 return chat

def deliver(p,transport,sessions,state=STATE,root=OUTPUTS):
 validate(p);chat=route(p,sessions);file=attachment(p,root)
 fingerprint=hashlib.sha256(json.dumps(p,sort_keys=True,separators=(',',':')).encode()+ (hashlib.sha256(file[1]).digest() if file else b'')).hexdigest()
 state.mkdir(parents=True,exist_ok=True,mode=0o700)
 if state.is_symlink() or (os.name=='posix' and state.stat().st_mode&0o077):fail('UNSAFE_STATE')
 record=state/(p['request_id']+'.json')
 if record.exists():
  if record.is_symlink():fail('UNSAFE_STATE')
  old=json.loads(record.read_text())
  if old.get('fingerprint')!=fingerprint:fail('REQUEST_CONFLICT')
  if old.get('status')!='accepted':fail('UNCERTAIN_DO_NOT_RETRY')
  return old
 # Validate live destination before persisting an irreversible send attempt.
 peer=transport('getChat',{'chat_id':chat},None)
 if peer.get('id')!=chat or peer.get('type')!='private':fail('ROUTE_NOT_PRIVATE')
 data={'fingerprint':fingerprint,'request_id':p['request_id'],'recipient':p['recipient'],'status':'attempt_started'}
 fd=os.open(record,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as out:json.dump(data,out);out.flush();os.fsync(out.fileno())
 try:
  result=transport('sendDocument' if file else 'sendMessage',{'chat_id':chat,**({'caption':p['text']} if file else {'text':p['text'],'link_preview_options':{'is_disabled':True}})},file)
  if result.get('chat',{}).get('id')!=chat or result['chat'].get('type')!='private' or not isinstance(result.get('message_id'),int):fail('RESPONSE_NOT_VERIFIED')
  if file:
   if result.get('caption')!=p['text'] or result.get('document',{}).get('file_name')!=file[0]:fail('RESPONSE_NOT_VERIFIED')
  elif result.get('text')!=p['text']:fail('RESPONSE_NOT_VERIFIED')
  data.update(status='accepted',message_id=result['message_id'],delivery='Telegram API accepted; read status unavailable')
  tmp=record.with_suffix('.pending');fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'w') as out:json.dump(data,out);out.flush();os.fsync(out.fileno())
  os.replace(tmp,record)
  return data
 except Exception:fail('UNCERTAIN_DO_NOT_RETRY')

def api(token):
 def send(method,payload,file):
  if file:
   boundary='Widya'+uuid.uuid4().hex;chunks=[]
   for key,value in payload.items():chunks.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+str(value)+'\r\n').encode())
   name,content=file
   if not re.fullmatch(r'[A-Za-z0-9_. -]{1,160}',name):fail('INVALID_FILENAME')
   chunks.extend([('--'+boundary+'\r\nContent-Disposition: form-data; name="document"; filename="'+name+'"\r\nContent-Type: application/octet-stream\r\n\r\n').encode(),content,('\r\n--'+boundary+'--\r\n').encode()]);body=b''.join(chunks);mime='multipart/form-data; boundary='+boundary
  else:body=json.dumps(payload).encode();mime='application/json'
  req=urllib.request.Request('https://api.telegram.org/bot'+token+'/'+method,data=body,headers={'Content-Type':mime})
  try:
   with urllib.request.urlopen(req,timeout=35) as response:raw=response.read(1024*1024+1)
   if len(raw)>1024*1024:fail('INVALID_RESPONSE')
   result=json.loads(raw)
   if result.get('ok') is not True:fail('API_REJECTED')
   return result['result']
  except Exception:fail('REQUEST_FAILED')
 return send

def main():
 if len(sys.argv)!=2 or len(sys.argv[1])>16384:fail('INVALID_REQUEST')
 p=validate(json.loads(sys.argv[1]));values={}
 for line in (PROFILE/'.env').read_text().splitlines():
  if line and not line.lstrip().startswith('#') and '=' in line:
   key,value=line.split('=',1);values[key.strip()]=value.strip().strip('"').strip("'")
 token=values.get('TELEGRAM_BOT_TOKEN','')
 if not token:fail('NOT_CONFIGURED')
 allowed=set(re.findall(r'\d+',values.get('TELEGRAM_ALLOWED_USERS','')))
 if str(RECIPIENTS[p['recipient']][0]) not in allowed:fail('RECIPIENT_NOT_ALLOWLISTED')
 result=deliver(p,api(token),json.loads(SESSIONS.read_text()));print(json.dumps({k:v for k,v in result.items() if k!='fingerprint'}))
if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error) if str(error).startswith('WIDYA_TELEGRAM_') else 'WIDYA_TELEGRAM_UNAVAILABLE'
  print(json.dumps({'error':code}));sys.exit(1)
