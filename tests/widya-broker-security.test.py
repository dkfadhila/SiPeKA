import unittest,importlib.util,pathlib,socket,json,struct
p=pathlib.Path(__file__).resolve().parents[1]/'docs/widya/receipt_broker.py';spec=importlib.util.spec_from_file_location('broker',p);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class Security(unittest.TestCase):
 def test_reject_overrides_size_trailing(self):
  for h,body in [({'v':1,'mime':'image/png','size':1,'path':'/etc/passwd'},b'x'),({'v':1,'mime':'image/png','size':6000001},b''),({'v':1,'mime':'image/png','size':True},b'x'),({'v':1,'mime':'image/png','size':1},b'xx')]:
   with self.subTest(header=h):
    a,c=socket.socketpair()
    try:
     raw=json.dumps(h).encode();a.sendall(struct.pack('!I',len(raw))+raw+body);a.shutdown(socket.SHUT_WR)
     with self.assertRaises(ValueError):b.read_request(c)
    finally:a.close();c.close()
 def test_peer_kernel_identity(self):
  if not hasattr(socket,'SO_PEERCRED'):self.skipTest('Linux kernel required')
  import os
  a,c=socket.socketpair()
  try:self.assertTrue(b.allowed_peer(c,os.getuid()));self.assertFalse(b.allowed_peer(c,os.getuid()+1))
  finally:a.close();c.close()
if __name__=='__main__':unittest.main()
