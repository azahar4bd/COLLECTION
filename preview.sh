#!/usr/bin/env bash
# স্যান্ডবক্স প্রিভিউ চালু করে (Neon-এ কিছু লেখে না — সব মেমোরিতে)
cd "$(dirname "$0")" || exit 1
[ -f preview-data.json ] || echo "⚠️  preview-data.json নেই — ডেমো ডেটা দিয়ে চলবে"
exec node sandbox-server.mjs
