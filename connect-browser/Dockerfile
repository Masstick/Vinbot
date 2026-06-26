# connect-browser/Dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb x11vnc novnc websockify socat ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

# Certaines images Debian nomment le binaire "chromium" ; on s'assure qu'il est dans le PATH.
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 6080 9222
CMD ["/start.sh"]
