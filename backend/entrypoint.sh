#!/bin/sh
set -eu
# A fresh named volume is root-owned. Initialise it before dropping privileges.
mkdir -p "${NCRL_FILES_DIR:-/var/lib/ncrl/files}"
chown -R app:app "${NCRL_FILES_DIR:-/var/lib/ncrl/files}"
exec runuser -u app -- "$@"
