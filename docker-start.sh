#!/bin/sh
# PID 1 контейнера: Caddy (сайт) + фоновий node (/api/*).
#
# Свідоме рішення: здоров'я контейнера міряється ТІЛЬКИ Caddy (/_health).
# Traefik у Coolify знімає unhealthy-контейнер з роутингу цілком, тож якщо
# прив'язати health до node, падіння CRM/заявок гасило б увесь сайт.
# Node натомість перезапускається тут у циклі.
set -eu

(
	while true; do
		node /app/api/server.js || echo "[api] процес завершився, перезапуск через 3 с"
		sleep 3
	done
) &
API_PID=$!

CADDY_PID=''
# назва функції латиницею навмисно: sh в Alpine не приймає кириличних імен
shutdown_all() {
	if [ -n "$CADDY_PID" ]; then kill "$CADDY_PID" 2>/dev/null || true; fi
	kill "$API_PID" 2>/dev/null || true
}
trap shutdown_all TERM INT

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!
wait "$CADDY_PID"
