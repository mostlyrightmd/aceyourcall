# Deployment

## Local Linux

Follow the README. Compose uses host networking so the gateway and operator can keep their strict loopback security boundary. Only use localhost in this mode. Docker Desktop's ordinary bridge mode is not the supported quickstart; macOS/Windows users can use the hosted app, UI review, or a Linux VM.

## Internet-accessible Linux VM

Use a dedicated VM with Docker Engine, Compose v2.20+, Python 3, a static public IPv4 and a domain. Start with 2 vCPU/4 GB RAM as a conservative evaluation target, then measure your workload. This is not a benchmark-backed capacity guarantee. One interview is the supported default.

1. Create DNS-only A records for `your-domain`, `rtc.your-domain`, and `turn.your-domain`, pointing at the VM. Avoid a CDN proxy on the media hosts.
2. Allow inbound TCP 443; TCP 7881; UDP 3478 and 50000–50200. Restrict SSH to your administration path. Do not expose operator port 4317, gateway 4320, LiveKit API 7880 or TURN proxy backend 15349 directly. Caddy handles public TLS on 443.
3. Run `sudo python3 selfhost/setup.py --domain practice.example.com --ip YOUR_STATIC_IPV4`.
4. Run `sudo docker compose -f selfhost/compose.yaml --profile https up --build -d`.
5. Wait for trusted certificates; check the app and both media hostnames. Never bypass browser certificate warnings.
6. Open the private creator URL from `selfhost/generated/creator-url.txt` on your browser. This grants creation access; share individual room links with cofounders, not this capability.
7. Test two devices on different networks, then a restrictive network requiring TURN. Check audio in both directions, captions, timer shutdown and scorecard delivery before inviting others.

For anonymous public creation, create a Cloudflare Turnstile widget for your domain and supply its sitekey/secret as environment variables, then use `sudo --preserve-env=MP_TURNSTILE_SITEKEY,MP_TURNSTILE_SECRET python3 selfhost/setup.py --domain practice.example.com --ip YOUR_STATIC_IPV4 --anonymous`. This mode is intentionally rate-limited. Keep budget caps, queue limits and webhook expiry enabled. Replace the self-hosted legal notice with your policies before serving other users.

The setup uses LiveKit's embedded TURN service. LiveKit runs on a dedicated Docker network (172.29.92.0/24); check `docker network ls` and your host routes for a conflict before setup. If it conflicts, update the subnet/gateway in setup.py, its webhook URL and trusted proxy CIDR, and the relay bind in start.mjs together before generating configuration. A webhook-only relay listens on the bridge gateway and forwards signed LiveKit events to the loopback app; other routes return 404. TURN advertises TLS 443; Caddy forwards through a loopback-only mapping to the container's port 443 with PROXY v2 client-address information. The selected Caddy layer-4 image routes TLS by hostname to web, signalling and TURN backends. Application traffic and media have different network requirements; putting the frontend alone on a static hosting service is insufficient.

## Upgrades

Back up configuration and the application volume; fetch a reviewed release, rebuild, and restart only after calls finish. Never rerun setup over existing credentials. See operations for backup and rollback. Production deployments should pin reviewed image digests; the shipped Node/LiveKit versions are fixed release tags, Caddy is digest-pinned.

References: [LiveKit self-hosting](https://docs.livekit.io/transport/self-hosting/deployment/), [ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/), [Turnstile hostnames](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/).
