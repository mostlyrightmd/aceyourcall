# Troubleshooting

| Symptom | Check |
| --- | --- |
| Cannot create a room | Local mode requires localhost. Remote private mode needs the creator URL. Public mode needs a valid Turnstile widget hostname and token. |
| Camera/microphone unavailable | Browser permission and HTTPS (or localhost); verify OS device access. |
| Room opens but audio fails | Browser-reachable RTC URL, trusted certificate, TCP 7881 and UDP media range; test TURN on a separate network. |
| Interview never starts | Key/model access, available balance, paid flag, worker health and reserved headroom. A normal Chat subscription is not itself an API key. |
| Waiting while nobody is speaking | A worker may still be closing a session or holding an uncertain reservation. Inspect state and provider session closure rather than removing guards. |
| Interview stops | Keep host browser awake; inspect connection status and provider errors. Network/browser suspension may interrupt the host-owned AI transport. |
| Scorecard delayed | Wait for session closure and the automatic generation state. Use retry if offered; preserve the transcript. |
| Application disappears after restart | Expected: application context is memory-only. Paste it again or use the optional browser draft. |
| Invalid Host/Origin | Ensure configured origin exactly matches scheme, hostname and port used by the browser. |
| Container permission denied | Config and volume must be accessible to UID 1000; do not solve this by making key files public. |

When reporting a bug, include version, browser, deployment mode, redacted error, approximate timing and reproduction steps. Do not attach API keys, creator URLs, private room links or real applications/transcripts to a public issue.
