# V61 Upstream-diff audit fixes

- Add an empty-weapon-slot guard to `WeaponManager.reload()` (ported from
  upstream 0.3.11): reloading a slot whose gun was just removed used to crash
  in `getTrueAmmoStats` on an undefined gun definition.
