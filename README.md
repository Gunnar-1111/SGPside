# SGPside

Cross-sport pricing hub — prices player props, same-game parlays (SGPs), and
cross-sport parlays across the `-Side` engine family (CourtSide/NBA,
DugoutSide/MLB, Ironside/NFL, HoopSide/WNBA, RinkSide/NHL, CageSide/UFC).

## Architecture

SGPside does **not** model any sport. Each `-Side` engine keeps its own
modeling and **publishes projections**; SGPside **consumes and prices** them,
sport-agnostically. If SGPside ever needs sport-specific logic to price a leg,
the contract is wrong.

- **`CONTRACT.md`** — the projection contract: the schema every engine emits
  and SGPside consumes. The load-bearing interface of the whole system.

## Status

Pre-build. `CONTRACT.md` v0.1 is defined. First engine integration: CourtSide
emits the contract via `scripts/emit-contract.py` in the CourtSide repo —
proving the schema against a real engine before SGPside is built on top of it.
