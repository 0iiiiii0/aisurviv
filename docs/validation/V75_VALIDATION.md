# V75 Validation

## Builds

- Server TypeScript production build: PASS
- Client TypeScript + Vite build: PASS
- `admin.js` syntax check: PASS
- `test:admin`: PASS
- `test:v41-suite` (11 tests): PASS
- V53–V74 regression tests: PASS

## Removal verification

- `adminServer.ts` no longer defines `setModeEnabled` or `/admin-api/mode-action`: PASS
- `admin.js` no longer references `setModeEnabled`, `enabled-mode-count`,
  `mode-toggle`, or `mode-status`: PASS
- `index.html` no longer contains `enabled-mode-count`: PASS
- `admin.css` no longer styles `.mode-toggle-button` / `.mode-status` /
  `.mode-status-light` / `.mode-card-controls`: PASS
- `adminSmokeTest` asserts the per-mode switch is gone
  (`service.setModeEnabled === undefined`): PASS
- Duel random/room mode toggles remain in the duel config panel: PASS
- Mode select dropdown still shows the informational "（未公开）" suffix when a
  mode is disabled in the config file: PASS

## Files changed

- `server/src/adminServer.ts`
- `server/src/adminSmokeTest.ts`
- `client/public/admin/admin.js`
- `client/public/admin/index.html`
- `client/public/admin/admin.css`