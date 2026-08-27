#!/usr/bin/env bash
# Create the `development` branch OFF `main` — branch creation captured in code.
# `main` = clean/demo branch; `development` = build branch (all Build 1/2/3 work lands here,
# then merges to main to "promote"). Idempotent + reproducible.
set -euo pipefail

git checkout main                              # start from main
git pull --ff-only origin main || true

# Branch development off main (no-op if it already exists)
git checkout -b development 2>/dev/null || git checkout development
git rebase main || true                        # keep development based on main

git push -u origin development                 # publish the branch

# Prove it branched off main:
echo "main            : $(git rev-parse main)"
echo "development     : $(git rev-parse development)"
echo "branch point    : $(git merge-base main development)   # == main's base => development is off main"
git log --graph --oneline --decorate main development | head -20
