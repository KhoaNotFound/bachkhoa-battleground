"""Manage admin (inspect map) keys. Only SHA-256 hashes are stored, in js/admin.js.

  python3 tools/admin_key.py add <label>      # prints a new key once; give it to that person privately
  python3 tools/admin_key.py list
  python3 tools/admin_key.py revoke <label>

The person opens https://khoanotfound.github.io/bachkhoa-battleground/?admin=<key> once per
browser. Changes take effect after the site is deployed.
"""
import hashlib
import re
import secrets
import sys
from pathlib import Path

ADMIN_JS = Path(__file__).resolve().parent.parent / 'js' / 'admin.js'
MARK = '  // @admin-keys'
ENTRY = re.compile(r"^  '([0-9a-f]{64})': '([^']*)',\n", re.M)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('add', 'list', 'revoke'):
        print(__doc__)
        return 1
    src = ADMIN_JS.read_text()
    cmd = sys.argv[1]
    entries = ENTRY.findall(src)
    if cmd == 'list':
        for h, label in entries:
            print(f'{label:20s} {h[:12]}…')
        return 0
    if len(sys.argv) < 3:
        print('label required')
        return 1
    label = re.sub(r"[^\w .-]", '', sys.argv[2])[:40]
    if cmd == 'add':
        if any(l == label for _, l in entries):
            print(f'label "{label}" already exists')
            return 1
        key = secrets.token_urlsafe(12)
        h = hashlib.sha256(key.encode()).hexdigest()
        ADMIN_JS.write_text(src.replace(MARK, f"  '{h}': '{label}',\n{MARK}", 1))
        print(f'added "{label}". Key (shown only now): {key}')
        print(f'link: https://khoanotfound.github.io/bachkhoa-battleground/?admin={key}')
    else:
        new = re.sub(rf"^  '[0-9a-f]{{64}}': '{re.escape(label)}',\n", '', src, flags=re.M)
        if new == src:
            print(f'no key labeled "{label}"')
            return 1
        ADMIN_JS.write_text(new)
        print(f'revoked "{label}"')
    return 0


if __name__ == '__main__':
    sys.exit(main())
