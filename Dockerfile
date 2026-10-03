# Сайт — статика без збірки (лежить у корені репо) + функції /api,
# які на Vercel були serverless. Caddy віддає статику, node — /api/*.
FROM caddy:2.8-alpine

RUN apk add --no-cache nodejs

# Усе, що не відсік .dockerignore, лягає в корінь сайту; службове
# (api/, Caddyfile, docker-start.sh) одразу виноситься звідти, щоб Caddy
# не віддавав код функцій і конфіги як статичні файли.
COPY . /srv/
RUN mkdir -p /app \
	&& mv /srv/api /app/api \
	&& mv /srv/Caddyfile /etc/caddy/Caddyfile \
	&& mv /srv/docker-start.sh /docker-start.sh \
	&& chmod +x /docker-start.sh \
	&& caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

EXPOSE 8080

# Перевіряє лише віддачу статики — див. коментар у docker-start.sh.
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
	CMD wget -qO- http://127.0.0.1:8080/_health >/dev/null 2>&1 || exit 1

CMD ["/docker-start.sh"]
