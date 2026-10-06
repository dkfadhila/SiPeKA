"""Read-only operational report; no credentials, payroll or ledger mutations."""
import datetime as dt
import json
from pathlib import Path
import shutil
import subprocess
import urllib.request
from zoneinfo import ZoneInfo

HOME = Path('/home/ubuntu/.hermes/profiles/widya')
STATE = HOME / 'monitoring'
TZ = ZoneInfo('Asia/Jakarta')

def command(args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return p.stdout.strip() if p.returncode == 0 else 'unavailable'
    except (OSError, subprocess.TimeoutExpired):
        return 'unavailable'

def endpoint(path):
    try:
        request = urllib.request.Request('https://widyafa.xyz' + path, headers={'User-Agent': 'curl/8.5.0'})
        with urllib.request.urlopen(request, timeout=15) as r:
            payload = json.loads(r.read(4096)) if path.startswith('/api/') else None
            return r.status == 200 and (payload is None or payload.get('ok') is True)
    except Exception:
        return False

def backup(unit):
    props = command(['systemctl', 'show', unit, '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'InactiveEnterTimestamp'])
    values = dict(line.split('=', 1) for line in props.splitlines() if '=' in line)
    journal = command(['sudo', '-n', 'journalctl', '-u', unit, '--since', '24 hours ago', '-o', 'cat', '--no-pager'])
    targets = {}
    for line in journal.splitlines():
        if not line.startswith('{'):
            continue
        try:
            data = json.loads(line)
            items = data.get('backups', [data])
            for item in items:
                for key in ('data', 'manifest'):
                    for target in item.get(key, {}).get('targets', []):
                        name = target.get('target')
                        if name in ('r2', 'supabase'):
                            targets[name] = targets.get(name, True) and target.get('ok') is True
        except (ValueError, TypeError, AttributeError):
            continue
    return {'result': values.get('Result', 'unavailable'), 'exit': values.get('ExecMainStatus', '?'), 'completed': values.get('InactiveEnterTimestamp', '?'), 'targets': targets}

def daily_summary(samples, now):
    recent = [s for s in samples if 0 <= (now - dt.datetime.fromisoformat(s['time'])).total_seconds() <= 86400]
    failed = sum(not all(s[k] for k in ('website', 'health', 'ready', 'db')) or any(b['result'] != 'success' for b in s['backups'].values()) for s in recent)
    return f'Ringkasan 24 jam: {len(recent)} pemeriksaan tersimpan, {failed} pemeriksaan bermasalah. Cakupan sejak instalasi; bukan pemantauan kontinu atau laporan keuangan lengkap.'

def main():
    now = dt.datetime.now(TZ)
    sql = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT 'db_ok'; SELECT 'ledger_count=' || count(*) FROM ledger_transactions; SELECT 'pending_count=' || count(*) FROM ledger_transactions WHERE status='PENDING'; SELECT 'branch_count=' || count(*) FROM business_units; COMMIT;"
    db = command(['sudo', '-n', '-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', 'sipeka', '-Atc', sql])
    disk = shutil.disk_usage('/')
    sample = {'time': now.isoformat(), 'website': endpoint('/'), 'health': endpoint('/api/health'), 'ready': endpoint('/api/ready'), 'db': 'db_ok' in db, 'backups': {u: backup(u) for u in ('sipeka-pg-backup.service', 'sipeka-backup.service')}}
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    history = STATE / 'samples.jsonl'
    samples = []
    if history.exists():
        for line in history.read_text().splitlines():
            try:
                samples.append(json.loads(line))
            except ValueError:
                pass
    samples.append(sample)
    with history.open('a', encoding='utf-8') as f:
        f.write(json.dumps(sample) + '\n')
    lines = [f'Widya | laporan operasional {now:%Y-%m-%d %H:%M} WIB', 'Mandat: pemeriksaan read-only; tanpa perubahan DB/deploy.', 'Website: ' + ('OK' if sample['website'] else 'GAGAL'), 'Health API: ' + ('OK' if sample['health'] else 'GAGAL'), 'Readiness PostgreSQL: ' + ('OK' if sample['ready'] else 'GAGAL'), 'DB query read-only: ' + ('OK' if sample['db'] else 'TIDAK TERSEDIA'), f'Disk / terpakai: {disk.used / disk.total:.1%}', 'Gateway: ' + command(['systemctl', '--user', 'is-active', 'hermes-gateway.service'])]
    lines.extend(l for l in db.splitlines() if l.startswith(('ledger_count=', 'pending_count=', 'branch_count=')))
    for unit, b in sample['backups'].items():
        targets = ', '.join(k + '=' + ('accepted' if v else 'FAILED') for k, v in sorted(b['targets'].items())) or 'offsite belum terverifikasi dari journal 24 jam'
        lines.append(f"Backup {unit}: {b['result']}, exit={b['exit']}, selesai={b['completed']}; {targets}.")
    if now.hour == 0:
        lines.append(daily_summary(samples, now))
    lines.append('Saldo/accrual/audit finansial tidak disimpulkan dari count ledger. Tidak ada PII payroll. Telegram API accepted bukan bukti dibaca Owner.')
    report = '\n'.join(lines)
    (STATE / 'latest.txt').write_text(report, encoding='utf-8')
    print(report)

if __name__ == '__main__':
    main()
