#!/bin/sh
set -e

# /data is normally a bind mount from the host. A bind mount replaces whatever
# the image put at /data, so the chown in the Dockerfile is shadowed and the
# directory arrives owned by whoever owns it on the host, usually root. Fix it
# here, while we are still root, then drop to the node user to run the app.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}/uploads"
  chown -R node:node "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

# Already running as a non-root user, so the host has to have got the
# ownership right itself. Nothing we can do from in here.
exec "$@"
