# V60 AI no longer loops on loot the backpack cannot hold

- `scoreLoot()` now caps heal/boost targets at the current backpack capacity
  and skips throwables when the bag is full. Previously the targets
  (bandage 10 / medkit 3 / soda 5 / painkiller 2 / frag 4) exceeded level-0
  backpack capacities (5 / 1 / 2 / 1 / 3), so the server rejected the pickup
  with `Pickup Full` and the bot kept re-targeting the same item forever.
- Handle `net.PickupMsgType.Full` in the AI message loop: blacklist the loot
  object for 8 seconds and release the current loot commitment so the bot
  re-plans instead of walking back to the same object every few seconds.
