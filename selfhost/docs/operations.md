# Operations

## Spending

At the published GPT-Live 1 rate on 3 November 2026, ten minutes of voice is about $0.50; reasoning, research, captions and scorecards add usage. Verify [current pricing](https://developers.openai.com/api/docs/models/gpt-live-1). The app reserves estimated headroom before starting. It may queue or reject a session even when a small positive balance remains.

App limits are estimates and do not certify provider credit balance or prevent credit-card billing. Use your provider's budget controls, check credit expiry, and keep a margin. Never rotate keys to evade account limits. A crashed session with uncertain remote closure retains its reservation until reconciled; do not delete the ledger to clear a queue.

## Health and failure recovery

`docker compose -f selfhost/compose.yaml ps` shows app health. Inspect logs without publishing application content, tokens or configuration. A stopped app should be restarted with the same volume. A scorecard can be retried from results if generation fails; it does not require a new interview. Keep the host tab open until the interview ends normally.

Stop admission before planned maintenance and wait for every LiveKit participant and AI session to leave. Never restart LiveKit during a call. The app process supervisor shuts down both gateway and worker together if one fails.

## Backups and retention

Preserve `selfhost/generated/` and the `app-data` Docker volume. They contain credentials and private transcripts. Stop services for a simple consistent volume backup; encrypt and restrict access to backups. Do not use `down -v` unless you intend to permanently delete stored sessions. Test restoring a backup on an isolated installation before relying on it.

Application text is memory-only and does not survive a restart. Browser drafts can restore it; users may need to supply it again. Rooms expire after 24 hours, stored interview records after up to 30 days. History is not an unlimited account archive. Backups have their own retention obligation and are not removed by live database cleanup.

## Scaling

One worker handles one interview. The operator pool can configure up to 20 loopback workers with separate data directories, ports and accounting. This is a software ceiling, not a capacity claim. Load-test your hardware/provider quotas and cross-network media before raising concurrency. Shared provider budgets across multiple independently capped workers require an aggregate limit. Do not multiply the default budget silently.
