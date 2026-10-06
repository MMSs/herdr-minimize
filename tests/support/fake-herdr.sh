#!/bin/sh
# Test double for the herdr CLI: logs argv to $FAKE_HERDR_LOG and prints $FAKE_HERDR_OUT.
printf '%s\n' "$*" >> "$FAKE_HERDR_LOG"
printf '%s' "$FAKE_HERDR_OUT"
exit "${FAKE_HERDR_EXIT:-0}"
