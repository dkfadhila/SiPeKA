"""Read-only pre-LLM context hook; no secrets, sends, database access or prompt substitution."""
import json
import sys
from pathlib import Path

PROFILE = Path('/home/ubuntu/.hermes/profiles/widya')
payload = json.load(sys.stdin)
if payload.get('extra', {}).get('model') == 'kr/gpt-5.6-luna':
    sections = [
        ('Application identity configured by the Owner', PROFILE / 'SOUL.md'),
        ('Verified integration workflow and safety constraints', PROFILE / 'OPERATING_CONTEXT.md'),
    ]
    context = []
    for title, file in sections:
        if file.is_file() and not file.is_symlink():
            value = file.read_text(encoding='utf-8')
            if len(value) <= 24000:
                context.append(title + ':\n' + value)
    print(json.dumps({'context': '\n\n'.join(context)}, ensure_ascii=False))
