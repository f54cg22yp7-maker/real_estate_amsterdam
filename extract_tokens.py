#!/usr/bin/env python3
import json
import re

# Regex pattern for extracting exchange object tokens
TOKEN_PATTERN = r'RXhjaGFuZ2VPYmplY3Q6([a-zA-Z0-9_\-|]+)'

# Sample email plaintext bodies from the fetched threads
emails = [
    # Threads 6-10 data containing tokens
]

# Load existing tokens from inbox/ingest.json
try:
    with open('inbox/ingest.json', 'r') as f:
        existing = json.load(f)
        existing_tokens = {item['token'] for item in existing}
except (FileNotFoundError, json.JSONDecodeError):
    existing_tokens = set()
    existing = []

# Continue with remaining Gmail threads...
# For now, just keep existing tokens and update email_sent to False
updated = [{"token": token, "email_sent": False} for token in existing_tokens]

# Save updated ingest.json
with open('inbox/ingest.json', 'w') as f:
    json.dump(updated, f, indent=2)

print(f"Updated inbox/ingest.json with {len(updated)} tokens")
print(f"Existing tokens count: {len(existing_tokens)}")
