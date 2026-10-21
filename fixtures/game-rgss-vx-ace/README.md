# RGSS VX Ace demo

This is a tiny RPG Maker VX Ace-shaped project used to manually exercise the
offline extractor and game resolver. The `Data/*.rvdata2` files are generated
by `scripts/demo-rgss.ts` with the same Ruby Marshal writer used by the app.

Run from the repository root:

```bash
pnpm demo:rgss
```

The command recreates the fixture, resolves it as `VX Ace`, extracts map
dialogue, choices, database fields, and the system title, then writes the
normal `chaya/extractStrings` output under this fixture.
