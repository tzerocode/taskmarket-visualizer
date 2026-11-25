#!/usr/bin/env bash
# One-command deploy for the Taskmarket live market visualizer.
# 1. Fetches fresh data from the public Taskmarket API (no key).
# 2. Regenerates the share image with the live numbers.
# 3. If this directory is a git repo with a remote, commits and pushes
#    (GitHub Pages serves index.html from the repo root).
# 4. Otherwise prints the manual hosting steps.
set -euo pipefail
cd "$(dirname "$0")"

python3 fetch-data.py
python3 -c "import PIL" 2>/dev/null && python3 make-og.py || echo "PIL not installed; keeping the committed og.png (pip install pillow to regenerate)."

if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
  git add -A
  git diff --cached --quiet || git commit -m "data: refresh $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git push origin HEAD
  echo "Pushed. If GitHub Pages is enabled (Settings > Pages > Deploy from branch), the site is live at https://<user>.github.io/<repo>/"
else
  echo "No git remote yet. To go live:"
  echo "  1. git init && git add -A && git commit -m 'Taskmarket live visualizer'"
  echo "  2. Create an empty public repo on GitHub, then: git remote add origin <url> && git push -u origin HEAD"
  echo "  3. Enable GitHub Pages (Settings > Pages > Deploy from branch, root) — or drag this folder into Netlify Drop / Cloudflare Pages."
  echo "  4. The hourly refresh runs via .github/workflows/refresh.yml once the repo exists."
fi
