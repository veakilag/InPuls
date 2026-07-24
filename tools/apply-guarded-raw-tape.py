name: Apply guarded raw tape

on:
  push:
    branches:
      - agent/guarded-raw-tape-clean

permissions:
  contents: write

jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout branch
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Apply guarded raw tape
        run: python tools/apply-guarded-raw-tape.py

      - name: Validate JavaScript
        run: |
          node --check orderbook-worker.js
          node --check orderbook-tape-guard.js

      - name: Run guarded tape tests
        run: node --test test-orderbook-guarded-raw-tape.mjs

      - name: Commit generated change
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          if git diff --cached --quiet; then
            echo "No generated changes"
            exit 1
          fi
          git commit -m "Enable guarded raw tape"
          git push
