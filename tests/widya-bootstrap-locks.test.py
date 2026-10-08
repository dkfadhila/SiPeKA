import importlib.util,pathlib,tempfile,unittest,fcntl,os
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('worker',ROOT/'docs/widya/receipt_vision.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class Locks(unittest.TestCase):
 def test_exact_precreated_lease_readonly_shared_lock(self):
  with tempfile.TemporaryDirectory() as tmp:
   generation=pathlib.Path(tmp);lease=generation/'.leases/widya-receipt-vision';lease.parent.mkdir();lease.touch();lease.chmod(0o400)
   release=worker.pin_reviewed_generation(generation,{generation:lease})
   fd=os.open(lease,os.O_RDONLY)
   with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   release();fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);os.close(fd)
   self.assertTrue(lease.is_file())
   with self.assertRaises(ValueError):worker.pin_reviewed_generation(generation/'other',{generation:lease})
if __name__=='__main__':unittest.main()
