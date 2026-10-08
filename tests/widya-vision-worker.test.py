import unittest,importlib.util
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'docs/widya/receipt_vision.py'
class WorkerTests(unittest.TestCase):
 def test_exact_private_bytes_only(self):
  spec=importlib.util.spec_from_file_location('worker',p);w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
  self.assertEqual(w.validate_input({'image':'aGVsbG8=','mime':'image/png'}),(b'hello','image/png'))
  for value in [{'image':'aGVsbG8=','mime':'image/png','model':'evil'},{'image':'https://evil.test/a.png','mime':'image/png'},{'image':'!','mime':'image/png'},{'image':'aGVsbG8=','mime':'image/svg+xml'}]:
   with self.assertRaises(ValueError):w.validate_input(value)
if __name__=='__main__':unittest.main()
