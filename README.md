# AceYourCall

Practice a YC or Speedrun interview with an AI partner. Bring your application, join alone or with cofounders, and get a transcript, scorecard and specific suggestions.

**[Try the hosted app](https://aceyourcall.com)** · **[Self-host](#self-host)** · [Configuration](selfhost/docs/configuration.md) · [Troubleshooting](selfhost/docs/troubleshooting.md)

Independent practice, not affiliated with YC or a16z. Interviewer research informs preparation; the AI does not impersonate a real person or clone their voice.

## Self-host

**Beta:** the offline Docker installation and automated flows are tested. A fresh-domain, two-device paid interview remains a release-validation step; verify media and scorecards on your deployment before inviting users.

The initial supported deployment is **Linux with Docker Engine and Compose v2.20+**. The default is a local, single-interview installation. Use the [public VM guide](selfhost/docs/deployment.md) for remote cofounders or anonymous visitors.

You need an OpenAI project API key with **GPT-Live 1** and **GPT-6 Luna** access and available API balance. [Check model access and pricing](https://developers.openai.com/api/docs/models/gpt-live-1). Chat subscriptions alone are not an API key. Voice usage, reasoning, transcription, research and scorecards are charged to your account; the software does not make them free.

```sh
git clone https://github.com/mostlyrightmd/aceyourcall.git
cd aceyourcall
sudo python3 selfhost/setup.py
sudo docker compose -f selfhost/compose.yaml up --build -d
```

The setup prompts privately for your key, generates service credentials, and enables a **$5/day, $10 total application spending allowance**. These are conservative application estimates, not a provider-side billing guarantee. Set provider budgets and review [cost controls](selfhost/docs/operations.md).

Open **http://localhost:4320** on the same Linux machine. Paste or upload an application, enter the room and start. Keep the host browser open. For a remote Linux machine, use the HTTPS deployment guide; forwarding only the web port is not enough for media.

```sh
# Offline setup: renders the app but does not enable paid AI calls.
sudo python3 selfhost/setup.py --no-key
# Stop without deleting transcripts, configuration or credentials.
sudo docker compose -f selfhost/compose.yaml down
```

Run setup once. Preserve `selfhost/generated/` on upgrades; recreating credentials invalidates saved room links. This folder contains secrets and must never be committed or shared.

## What's included

- Ten-minute YC and Speedrun practice, solo or up to three founders.
- Application-specific questions, interviewer research, turn-taking and time limits.
- Live video rooms, named captions, transcript and automatic scorecards.
- Local draft preferences, room links, interview history within room lifetime.
- Light/dark themes and deterministic UI review screens.

The host browser carries the AI audio connection. Host departure, browser suspension or network loss can interrupt the interview. Room links expire; this is not a permanent account-based archive. Self-hosting starts with **one concurrent interview**, not an unverified twenty-call promise.

## Data

Application text is held temporarily in server memory and sent to OpenAI for the interview. It is not saved as an application document in the database. Transcripts and scorecards **are stored** and may repeat application facts; retention is up to 30 days. Optional browser drafts stay on that browser. Public interviewer research is cached. No raw audio/video recording is created by this app; audio is streamed to providers. See [architecture and data handling](selfhost/docs/architecture.md).

Self-hosted analytics are disabled by default. The public source does not send your sessions to Mostly Right. An operator who opens their installation to others must supply their own notices, policies and contact information.

## Development

Node.js 24.22.2 or newer compatible Node 24 release, npm and Python 3:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run ui:review
```

Mock UI review runs locally without an OpenAI key. Browser tests: `npx playwright install chromium` then `npm run test:browser`. Do not run backend and browser suites simultaneously: some fixtures share ports.

## Documentation

[Deployment](selfhost/docs/deployment.md) · [Configuration](selfhost/docs/configuration.md) · [Operations](selfhost/docs/operations.md) · [Troubleshooting](selfhost/docs/troubleshooting.md) · [Architecture](selfhost/docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License

Code: [Apache-2.0](LICENSE). Third-party notices and brand-asset conditions: [NOTICE](NOTICE) and [asset inventory](selfhost/docs/assets.md). AceYourCall and Mostly Right branding is not a grant of trademark rights. Generated backgrounds are optional decorative assets; remove or replace them when branding your deployment.
