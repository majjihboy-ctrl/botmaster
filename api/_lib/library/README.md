# Reference bot library

Every `.xml` here must load into the app's real Blockly workspace and generate engine code
(enforced by `library-bots.spec.js`). Add a bot by dropping it in `own/` (your bots) or `examples/`
(third-party, for logic reference only) and running the tests.

Not included, on purpose:
- Legacy Binary Bot format files (`trade`/`tradeOptions` blocks) - they need the browser-only converter;
  open them in the app, save them again, and the re-saved Deriv Bot XML can be added here.
- `LOTUS_CRAZY_RECOVERY_BOT_V1.xml` (uses an `apollo_purchase` block this app does not define; use `_fixed`).
- `SmartDiffers_X6...xml` (1.7 MB; too large to ship in a serverless function).
