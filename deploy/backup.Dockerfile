FROM postgres:16-alpine
RUN apk add --no-cache aws-cli
COPY deploy/backup.sh /usr/local/bin/backup
RUN chmod +x /usr/local/bin/backup
CMD ["/bin/sh", "-c", "while true; do backup; sleep 86400; done"]
