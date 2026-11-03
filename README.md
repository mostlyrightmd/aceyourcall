# AceYourCall

Your first attempt shouldn’t be the real interview.

Practice a ten-minute YC or Speedrun interview with AI, alone or with your cofounders. Bring your application. Leave with a transcript, scorecard and concrete ways to improve.

**[Start practicing →](https://aceyourcall.com)** · Free, no signup.

## Self-host

You’ll need Linux, Docker Compose 2.20+, Python 3 and a funded OpenAI API key with access to GPT-Live 1 and GPT-6 Luna.

```sh
git clone https://github.com/mostlyrightmd/aceyourcall.git
cd aceyourcall
sudo python3 selfhost/setup.py
sudo docker compose -f selfhost/compose.yaml up --build -d
```

Open **http://localhost:4320** on that Linux machine. Setup asks for your key privately. Keep the host browser open during interviews.

Defaults: one interview at a time, a $5 daily allowance and $10 total. API usage costs money; [spending controls](selfhost/docs/operations.md) use estimates, not a billing guarantee.

Inviting remote cofounders? Follow the [HTTPS deployment guide](selfhost/docs/deployment.md). This is a beta—test audio and scorecards on your deployment before sharing it.

## Your data

Raw applications stay in server memory. Derived preparation is cached for seven days; transcripts and scorecards for up to 30 days. All may contain application facts. Audio goes to OpenAI; we don’t record audio or video. [Data handling](selfhost/docs/architecture.md).

## Build on it

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run ui:review
```

Use Node 24.22.2+. UI review works without an API key.

[Configuration](selfhost/docs/configuration.md) · [Troubleshooting](selfhost/docs/troubleshooting.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

[Apache-2.0](LICENSE). [Brand and asset notices](NOTICE). Built by [Mostly Right](https://mostlyright.md). Independent of YC and a16z.
