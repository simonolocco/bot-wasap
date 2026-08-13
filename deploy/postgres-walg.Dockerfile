FROM postgres:16-bookworm

ARG WALG_VERSION=3.0.8
ARG WALG_ASSET=wal-g-pg-22.04-amd64.tar.gz

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && cd /tmp \
  && curl -fsSLO "https://github.com/wal-g/wal-g/releases/download/v${WALG_VERSION}/${WALG_ASSET}" \
  && curl -fsSLO "https://github.com/wal-g/wal-g/releases/download/v${WALG_VERSION}/${WALG_ASSET}.sha256" \
  && sha256sum -c "${WALG_ASSET}.sha256" \
  && tar -xzf "${WALG_ASSET}" \
  && install -m 0755 "${WALG_ASSET%.tar.gz}" /usr/local/bin/wal-g \
  && rm -rf /var/lib/apt/lists/* /tmp/wal-g*

COPY deploy/walg-backup.sh /usr/local/bin/walg-backup
RUN chmod +x /usr/local/bin/walg-backup
