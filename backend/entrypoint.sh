#!/bin/sh
set -eu
# A fresh named volume is root-owned. Initialise it before dropping privileges.
mkdir -p "${NCRL_FILES_DIR:-/var/lib/ncrl/files}"
mkdir -p "${NCRL_MODELS_DIR:-/var/lib/ncrl/models}"
chown -R app:app "${NCRL_FILES_DIR:-/var/lib/ncrl/files}"
chown -R app:app "${NCRL_MODELS_DIR:-/var/lib/ncrl/models}"
exec runuser -u app -- "$@"
