# MarketLab

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
