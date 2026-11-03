# Configuration

`selfhost/setup.py` generates `selfhost/generated/app.json`, `livekit.yaml`, `operators.json`, an OpenAI key file and (for HTTPS) `caddy.json`. Files are private; setup does not print secrets. On Linux, the application runs as UID 1000. If your setup user has another UID, assign the generated directory to UID 1000 without making it world-readable. Generated credentials must remain stable across upgrades.

| Setting | Purpose |
| --- | --- |
| OPENAI_API_KEY_FILE | Server-side file, preferred. Takes precedence over the environment key; an unreadable file fails closed. |
| OPENAI_API_KEY | Alternative server environment key. Never put it in a frontend build variable. |
| MP_PAID_ENABLED | `1` enables paid operations. Offline setup uses `0`. |
| MP_APPROVED_USD | Lifetime estimated spending allowance for this installation's ledger. Default 10. |
| MP_DAILY_CAP_USD | Daily estimated cap, default 5. |
| MP_CYCLE_CAP_USD | Billing-cycle estimate cap, default 10. |
| MP_CREDIT_EXPIRES_AT | Optional ISO expiry; stop using this key when credits expire. |
| MP_CALL_ORIGIN | Public HTTP(S) origin without trailing slash. HTTPS for remote devices. |
| MP_CALL_ALIAS_ORIGINS | Comma-separated explicit legacy origins, same-host Origin checks still enforced. |
| LIVEKIT_URL | Browser-reachable WebSocket URL. |
| LIVEKIT_INTERNAL_URL | Gateway-to-LiveKit HTTP URL, kept on loopback in the provided setup. |
| MP_CALL_ACCESS | Random creator capability. Do not share the creator URL publicly. |
| MP_COMMUNITY_PREVIEW | Loopback-only anonymous creation for local development. |
| MP_PUBLIC_LAUNCH | Anonymous public creation; requires Turnstile, worker pool and verified media webhook. |
| MP_TURNSTILE_SITEKEY / MP_TURNSTILE_SECRET | Your widget credentials; hostname must match the app domain. |
| MP_POSTHOG_TOKEN / MP_POSTHOG_HOST | Optional analytics destination you control; disabled in generated config. |
| MP_OPERATOR_POOL_PATH | Defaults to one loopback operator; advanced pools support up to 20 configured operators. |

Restart the app after editing app.json. Ports must stay consistent across app, LiveKit, proxy and firewall settings. An optional GCP Secret Manager adapter exists for hosted operations; self-hosting does not require gcloud.

Models currently used: GPT-Live 1 for voice; GPT-6 Luna for analysis, agenda, research and scorecards. Additional transcription model configuration is defined in source. Confirm your organization has access before enabling paid calls; this release does not silently substitute a model.
