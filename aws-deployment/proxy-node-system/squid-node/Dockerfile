FROM ubuntu:22.04

LABEL maintainer="ProxyNodeSystem"
LABEL description="Squid Proxy Node with agent integration"

ENV DEBIAN_FRONTEND=noninteractive
ENV SQUID_VERSION=5.7
ENV PROXY_PORT=3128
ENV SSL_PORT=3129

# Install dependencies
RUN apt-get update && apt-get install -y \
    squid \
    squid-openssl \
    apache2-utils \
    curl \
    wget \
    jq \
    openssl \
    ca-certificates \
    cron \
    procps \
    netcat \
    && rm -rf /var/lib/apt/lists/*

# Create squid directories
RUN mkdir -p /var/spool/squid /var/log/squid /etc/squid/ssl_cert \
    && chown -R proxy:proxy /var/spool/squid /var/log/squid /etc/squid/ssl_cert

# Generate SSL certificate for HTTPS interception (MITM proxy)
RUN openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
    -subj "/C=US/ST=Proxy/L=Proxy/O=ProxyNodeSystem/CN=ProxyNodeCA" \
    -keyout /etc/squid/ssl_cert/myCA.pem \
    -out /etc/squid/ssl_cert/myCA.pem \
    && chown proxy:proxy /etc/squid/ssl_cert/myCA.pem

# Initialize SSL DB
RUN /usr/lib/squid/security_file_certgen -c -s /var/spool/squid/ssl_db -M 4MB \
    || true

# Copy Squid configuration
COPY squid.conf /etc/squid/squid.conf
COPY errorpage.css /etc/squid/errorpage.css

# Copy node agent scripts
COPY agent/ /opt/proxy-agent/
RUN chmod +x /opt/proxy-agent/*.sh

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create password file
RUN touch /etc/squid/passwd

# Expose ports
EXPOSE ${PROXY_PORT} ${SSL_PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD squidclient -h localhost -p ${PROXY_PORT} mgr:info 2>/dev/null | grep -q "Squid Object Cache" || exit 1

VOLUME ["/var/log/squid", "/var/spool/squid"]

ENTRYPOINT ["/entrypoint.sh"]
