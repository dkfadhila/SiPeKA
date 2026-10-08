import unittest,importlib.util,pathlib,socket,json,struct
p=pathlib.Path(__file__).resolve().parents[1]/'docs/widya/receipt_broker.py'
class BrokerTests(unittest.TestCase):
 def test_exact_protocol(self):
  self.assertTrue(p.exists(),'private broker missing')
  spec=importlib.util.spec_from_file_location('broker',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  a,b=socket.socketpair()
  try:
   raw=json.dumps({'v':1,'mime':'image/png','size':3}).encode();a.sendall(struct.pack('!I',len(raw))+raw+b'png');a.shutdown(socket.SHUT_WR)
   self.assertEqual(m.read_request(b),({'v':1,'mime':'image/png','size':3},b'png'))
  finally:a.close();b.close()
if __name__=='__main__':unittest.main()
