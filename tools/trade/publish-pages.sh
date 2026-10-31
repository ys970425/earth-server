#!/bin/sh
# app 폴더만 gh-pages 브랜치로 올려 GitHub Pages에서 보이게 함
# 주소: https://ys970425.github.io/earth-server/trade/
set -e
cd "$(dirname "$0")/../.."
git subtree split --prefix app -b gh-pages-tmp >/dev/null
git push -f origin gh-pages-tmp:gh-pages
git branch -D gh-pages-tmp >/dev/null
