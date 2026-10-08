"""Private socket-activated broker. Linux SO_PEERCRED, one request per connection.
No caller paths/prompts/routing/commands. stdin bytes only to fixed one-shot worker.
"""
import base64,json,os,socket,struct,subprocess,time,re,selectors
try:import pwd
except ImportError:pwd=None
from pathlib import Path
SOCKET='/run/widya-receipt-vision/vision.sock'
MAX_BYTES=6000000
MAX_RESPONSE=60000
MIMES={'image/png','image/jpeg','image/webp','image/gif'}
def exact(conn,n,deadline=None):
    out=bytearray()
    while len(out)<n:
        if deadline is not None:
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError()
            conn.settimeout(remaining)
        chunk=conn.recv(n-len(out))
        if not chunk:raise ValueError('TRUNCATED')
        out.extend(chunk)
    return bytes(out)
def read_request(conn):
    deadline=time.monotonic()+5
    length=struct.unpack('!I',exact(conn,4,deadline))[0]
    if not 1<=length<=256:raise ValueError('HEADER_SIZE')
    h=json.loads(exact(conn,length,deadline))
    if not isinstance(h,dict) or set(h)!={'v','mime','size'} or type(h['v']) is not int or h['v']!=1 or h['mime'] not in MIMES or type(h['size']) is not int or not 1<=h['size']<=MAX_BYTES:raise ValueError('HEADER')
    # Absolute ingress deadline; slow trickles cannot extend it.
    data=bytearray()
    while len(data)<h['size']:
        conn.settimeout(max(.001,deadline-time.monotonic()))
        if time.monotonic()>=deadline:raise TimeoutError()
        data.extend(exact(conn,min(65536,h['size']-len(data)),deadline))
    conn.settimeout(max(.001,deadline-time.monotonic()))
    if conn.recv(1):raise ValueError('TRAILING')
    return h,bytes(data)
def allowed_peer(conn,uid):
    return struct.unpack('3i',conn.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))[1]==uid
def send(conn,value):
    raw=json.dumps(value,separators=(',',':')).encode()
    if len(raw)>MAX_RESPONSE:raise ValueError('RESPONSE_SIZE')
    conn.settimeout(5);conn.sendall(struct.pack('!I',len(raw))+raw)
def worker(data,mime):
    launcher=Path('/home/ubuntu/.hermes/hermes-agent/.hermes/bin/hermes').read_text()
    python=re.search(r'^exec (/home/ubuntu/\.hermes/tools/[^\s]+/bin/python3) -I',launcher,re.M).group(1)
    env={'HOME':'/home/ubuntu','PATH':'/usr/bin:/bin','HERMES_HOME':'/home/ubuntu/.hermes/profiles/widya','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'}
    payload=json.dumps({'image':base64.b64encode(data).decode(),'mime':mime}).encode()
    p=subprocess.Popen([python,'-I',str(Path(__file__).with_name('receipt_vision.py'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
    deadline=time.monotonic()+145;out=bytearray();offset=0
    try:
        os.set_blocking(p.stdin.fileno(),False);os.set_blocking(p.stdout.fileno(),False)
        with selectors.DefaultSelector() as select:
            select.register(p.stdin,selectors.EVENT_WRITE);select.register(p.stdout,selectors.EVENT_READ)
            while select.get_map():
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError()
                for key,_ in select.select(remaining):
                    if key.fileobj is p.stdin:
                        offset+=os.write(p.stdin.fileno(),payload[offset:offset+65536])
                        if offset==len(payload):select.unregister(p.stdin);p.stdin.close()
                    else:
                        chunk=os.read(p.stdout.fileno(),65536)
                        if not chunk:select.unregister(p.stdout)
                        else:
                            out.extend(chunk)
                            if len(out)>MAX_RESPONSE-100:raise ValueError('WORKER_SIZE')
        if p.wait(timeout=max(.001,deadline-time.monotonic())):raise ValueError('WORKER')
    finally:
        if p.poll() is None:p.kill();p.wait()
        if not p.stdin.closed:p.stdin.close()
        p.stdout.close()
    value=json.loads(out)
    if set(value)!={'output','runtime','imageTransport'} or not isinstance(value['output'],str) or len(value['output'])>30000:raise ValueError('WORKER_RESPONSE')
    return value
def serve(listener):
    uid=pwd.getpwnam('sipeka').pw_uid;requests=[];accepted=0
    while accepted<500:
        conn,_=listener.accept()
        with conn:
            # Identity comes exclusively from kernel credentials, never request JSON.
            if not allowed_peer(conn,uid):continue
            now=time.monotonic();requests[:]=[t for t in requests if now-t<3600]
            if len(requests)>=60 or sum(now-t<60 for t in requests)>=6:
                try:send(conn,{'v':1,'error':'WIDYA_RECEIPT_RATE_LIMIT'})
                except OSError:pass
                continue
            requests.append(now);accepted+=1
            try:
                h,data=read_request(conn);value=worker(data,h['mime']);send(conn,{'v':1,'result':value})
            except Exception:
                try:send(conn,{'v':1,'error':'WIDYA_RECEIPT_VISION_FAILED'})
                except (OSError,ValueError):pass
            # Single serial worker: no threads, queue, agent loop or shared histories.
def main():
    if os.getuid()!=pwd.getpwnam('ubuntu').pw_uid:raise RuntimeError('BROKER_IDENTITY')
    if os.getenv('LISTEN_PID')==str(os.getpid()) and os.getenv('LISTEN_FDS')=='1':
        listener=socket.socket(fileno=3)
        if listener.family!=socket.AF_UNIX or listener.getsockname()!=SOCKET:raise RuntimeError('BROKER_SOCKET')
    else:
        # Ephemeral fixture / foreground only. RuntimeDirectory owned ubuntu:sipeka.
        listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);listener.bind(SOCKET);os.chmod(SOCKET,0o660);listener.listen(1)
    with listener:serve(listener)
if __name__=='__main__':main()
