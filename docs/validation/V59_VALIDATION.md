# V59 Validation

## Builds

- Server TypeScript production build: PASS
- `test:savannah-perks` (new): PASS
- `test:gameplay-roles`: PASS
- `test:all-modes`: PASS
- `test:v41-suite` (11 tests): PASS

## Fix verification (`test:savannah-perks`)

- Loot split bullets survive the Savannah kill-streak buff (the_hunted): PASS
- `hunted` buff is marked role-origin (`isFromRole`): PASS
- Replaced kill leader loses only role-origin perks, keeps loot perks: PASS
- `last_man` re-grants a colliding loot perk as role-origin and keeps
  unrelated loot perks: PASS
- `removePerk` with a missing type no longer deletes the last perk: PASS
- `removeRole()` is a no-op when no role is set: PASS

## Notes

- `isFromRole` is server-side only; perk wire serialization is unchanged, so
  the client protocol is unaffected.
