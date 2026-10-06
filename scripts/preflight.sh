#!/bin/sh
# Install-time check run by herdr's [[build]] step. Keep it POSIX sh: it runs
# before we know bun exists.
set -eu

min="1.2.0"

if ! command -v bun >/dev/null 2>&1; then
  echo "herdr-minimize needs Bun >= $min, but 'bun' is not on PATH." >&2
  echo "Install it from https://bun.sh, then reinstall the plugin." >&2
  exit 1
fi

have=$(bun --version)
lowest=$(printf '%s\n%s\n' "$min" "$have" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)
if [ "$lowest" != "$min" ]; then
  echo "herdr-minimize needs Bun >= $min, found $have. Run 'bun upgrade', then reinstall the plugin." >&2
  exit 1
fi

echo "bun $have OK"
