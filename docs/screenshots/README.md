# Screenshots

Live-UI evidence captured during development (headless Chromium over CDP against
the running dev admin at `http://127.0.0.1:4000`).

## phase6/ — audit + fixes (entity editing, category management, category browsing)
Before (audit — the broken state):
- `audit1-entity-editor-before.png` — "edit" showed only a Category dropdown + cross-links; all other fields read-only in the preview.
- `audit2-categories-before.png` — category page had only "set threshold"/"solve template"; no create/rename/reparent.
- `audit3-entities-flat-before.png` — entities were a flat table, no tree navigation.

After (fixes, verified working):
- `fix1-entity-edit-form.png` — full field editor (name/summary/body/aliases/attributes/images/relations/source + hide-source toggle).
- `fix1-entity-saved.png` — after Save: "✓ saved — ai-context regenerated", live preview updated.
- `fix2-categories-manage.png` — create form + per-node edit / + sub / threshold / delete controls.
- `fix2-category-edit-panel.png` — created "Fauna & Wildlife" + "Space Creatures", reparented under World.
- `fix3-category-tree-nav.png` — Entities tab with the expand/collapse category tree filtering the list ("category: ship").

## phase5/ — variance routing + re-weigh
- `categories-tree-badges.png` — taxonomy tree with pending-item badges.
- `scan-high-variance.png` — scan showing HIGH variance → routed to queue despite trusted category.
- `queue-variance-column.png` — review queue with the Variance column (19% pending, 5% auto_completed).
- `template-refine.png` — per-template "solve template" field-map editor.
