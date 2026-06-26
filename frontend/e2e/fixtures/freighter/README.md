# Freighter Extension Fixture

Place the **unpacked Freighter extension** in this directory.

## How to obtain

1. Install Freighter from https://freighter.app
2. Open `chrome://extensions`, enable Developer Mode, click "Pack extension" on Freighter.
3. Copy the unpacked extension folder contents here, or set `FREIGHTER_EXT_PATH` env var
   to point to its location.

## CI setup

In CI, set:

```yaml
env:
  FREIGHTER_EXT_PATH: /path/to/freighter-unpacked
  FREIGHTER_SEED: "your twelve word test mnemonic phrase here ..."
  BASE_URL: http://localhost:3000
```

The test account (`FREIGHTER_SEED`) should be pre-funded on testnet via
https://friendbot.stellar.org/?addr=<G...>
