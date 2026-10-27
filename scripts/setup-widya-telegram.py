#!/usr/bin/env python3
"""Install the narrow private Telegram helper and its skill; no service restart or sends."""
import argparse,json,os,pwd,shlex,tempfile
from pathlib import Path
APP=Path('/opt/sipeka/current');DEST=Path('/usr/local/bin/widya-telegram-send');SKILL=Path('/home/ubuntu/.hermes/profiles/widya/skills/sipeka-telegram-delivery')
TEXT='#!/bin/sh\nset -eu\nexec /usr/bin/python3 /usr/local/lib/sipeka-widya-telegram-send.py "$@"\n'
LIB=Path('/usr/local/lib/sipeka-widya-telegram-send.py')
def atomic(path,content,mode,uid=0,gid=0):
 if path.is_symlink():raise ValueError('WIDYA_TELEGRAM_UNSAFE_INSTALL')
 fd,tmp=tempfile.mkstemp(prefix='.widya-telegram-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as out:out.write(content);out.flush();os.fsync(out.fileno())
  os.chown(tmp,uid,gid);os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--check',action='store_true');a=p.parse_args()
 if a.apply==a.check or os.geteuid()!=0:raise ValueError('WIDYA_TELEGRAM_ROOT_INSTALL_REQUIRED')
 user=pwd.getpwnam('ubuntu');source=(APP/'scripts/widya-telegram-send.py').read_bytes();compile(source,str(LIB),'exec');guide=(APP/'docs/widya/telegram-delivery/SKILL.md').read_bytes()
 if a.apply:
  atomic(LIB,source,0o644);atomic(DEST,TEXT.encode(),0o755)
  SKILL.mkdir(parents=True,exist_ok=True,mode=0o700)
  if SKILL.is_symlink():raise ValueError('WIDYA_TELEGRAM_UNSAFE_INSTALL')
  os.chown(SKILL,user.pw_uid,user.pw_gid);os.chmod(SKILL,0o700);atomic(SKILL/'SKILL.md',guide,0o600,user.pw_uid,user.pw_gid)
 for path,expected,mode,uid in [(LIB,source,0o644,0),(DEST,TEXT.encode(),0o755,0),(SKILL/'SKILL.md',guide,0o600,user.pw_uid)]:
  if path.is_symlink() or path.read_bytes()!=expected or path.stat().st_uid!=uid or path.stat().st_mode&0o777!=mode:raise ValueError('WIDYA_TELEGRAM_INSTALL_MISMATCH')
 print(json.dumps({'ok':True,'mode':'apply' if a.apply else 'check','text_and_session_files':True,'recipients':['radit','tirta'],'messages_sent':0}))
if __name__=='__main__':
 try:main()
 except Exception as e:
  print(json.dumps({'error':str(e) if str(e).startswith('WIDYA_TELEGRAM_') else 'WIDYA_TELEGRAM_INSTALL_FAILED'}));raise SystemExit(1)
