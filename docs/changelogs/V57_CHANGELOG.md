# V57 50v50 AI leader opening-flare optimization

- A freshly appointed 50v50 leader now repositions to the friendly mid-back
  staging point immediately, even before it owns a flare gun, so the opening
  military airdrop can be called the moment a flare becomes available.
- `planLeaderFlare()` returns a concrete friendly-half staging point for the
  unarmed opening case ("opening staging while searching for flare") instead of
  bailing out with no plan; `use` stays false until the leader is armed.
- The unarmed opening leader walks to the cached staging point (unless it is
  committed to a nearby loot/crate target, an enemy is close, or the point
  leaves the safe circle), then resumes its flare search on arrival.
- Opening deployment now tolerates an existing airdrop at 26 units instead of
  42 so the first drop is not needlessly postponed.
