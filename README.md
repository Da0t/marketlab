# MarketLab

**[Public demo](https://dat-marketlab.vercel.app)** · [Source](https://github.com/Da0t/marketlab)

A paper-trading application with a Java price/time-priority matching engine, market and limit orders, cash and share reservations, fee analysis, feed recovery, and deterministic replay.

This is an independent application with its own source repository, API, UI, tests, CI, and deployment. All data and funds are synthetic.

## Run locally

Requires Python 3.12 and Java 17+ (JDK).

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://localhost:8000. Run `python -m pytest -q` for the automated checks.

## Public deployment

The Vercel configuration serves the real Java matching engine through a bounded replay adapter. Each visitor owns an isolated tab session. Refresh preserves that tab’s transcript; New session resets it. The hosted demo is not durable financial storage. Commands are capped at 200 per session and 1,000 simulated ticks.

The build downloads a checksum-pinned Temurin JDK, compiles the engine, and packages a minimal Java runtime. See deployment/java.json and scripts/prepare_vercel.py.

## Engineering details

See [MarketLab engine documentation](marketlab/README.md) and the tests for correctness guarantees and limitations.

## Browser verification

Install `playwright` and run `python -m playwright install chromium`, then `python scripts/check_public_browser.py --url https://dat-marketlab.vercel.app`. This checks anonymous access, visitor isolation, working workflows, and mobile layout.

## Inspiration

Matching-engine concepts are informed by [exchange-core](https://github.com/exchange-core/exchange-core), and inspectable market interfaces by [Perspective](https://github.com/perspective-dev/perspective). No third-party application code was copied or forked; these projects are not dependencies or affiliates.
