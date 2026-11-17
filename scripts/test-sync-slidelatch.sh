#!/usr/bin/env bash
set -euo pipefail

readonly sync="$(cd -- "$(dirname -- "$0")" && pwd)/sync-slidelatch.sh"
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
export GITHUB_OUTPUT="$tmp/output" GH_TOKEN=test-token
export PR_LOG="$tmp/pr-log" PR_RECORD="$tmp/pr-record"
mkdir -p "$tmp/bin"
export PATH="$tmp/bin:$PATH"
cat > "$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "$1:$2" in
  api:--method)
    [[ "$*" == *'repos/HYY-yu/SlideLatch/pulls'* && "$*" == *'state=all'* ]]
    if [[ -f "$PR_RECORD" ]]; then cat "$PR_RECORD"; fi
    ;;
  pr:create)
    [[ "$GH_REPO" == 'HYY-yu/SlideLatch' && "$*" == *'--base main'* ]]
    cat >/dev/null
    printf 'opened\n' >> "$PR_LOG"
    printf 'https://github.com/HYY-yu/SlideLatch/pull/123\n' > "$PR_RECORD"
    cat "$PR_RECORD"
    ;;
  *) exit 3 ;;
esac
STUB
chmod +x "$tmp/bin/gh"

init() {
  git init -qb main "$1"
  git -C "$1" config user.name Test
  git -C "$1" config user.email test@example.test
}

commit() {
  git -C "$1" add .
  git -C "$1" commit -qm "$2"
}

upstream="$tmp/upstream"
seed="$tmp/seed"
remote="$tmp/remote.git"
init "$upstream"
runtime=assets/ppt-node-dsl-project
mkdir -p "$upstream/$runtime/src" "$upstream/examples"
printf 'runtime\n' > "$upstream/$runtime/src/new.ts"
printf '{}\n' > "$upstream/$runtime/package.json"
printf '{}\n' > "$upstream/$runtime/package-lock.json"
printf 'license\n' > "$upstream/LICENSE"
printf 'sample\0file' > "$upstream/examples/ppt_example.pptx"
printf 'upstream skill\n' > "$upstream/SKILL.md"
commit "$upstream" release
sha=$(git -C "$upstream" rev-parse HEAD)
branch="codex/ppt-dsl-release-$sha"

init "$seed"
mkdir -p "$seed/packages/ppt-dsl"
printf 'previous provenance\n' > "$seed/packages/ppt-dsl/PROVENANCE.md"
printf 'obsolete\n' > "$seed/packages/ppt-dsl/obsolete.ts"
printf 'consumer skill\n' > "$seed/SKILL.md"
commit "$seed" base
git clone -q --bare "$seed" "$remote"

fresh() {
  git clone -q "$remote" "$1"
  : > "$GITHUB_OUTPUT"
}

prepare() {
  bash "$sync" prepare "$upstream" "$1" "$sha"
  [[ $(cat "$GITHUB_OUTPUT") == 'changed=true' ]]
}

fresh "$tmp/first"
prepare "$tmp/first"
git -C "$tmp/first" diff --quiet HEAD^ HEAD -- . ':(exclude)packages/ppt-dsl'
test ! -e "$tmp/first/packages/ppt-dsl/obsolete.ts"
cmp "$upstream/$runtime/src/new.ts" "$tmp/first/packages/ppt-dsl/src/new.ts"
cmp "$upstream/examples/ppt_example.pptx" "$tmp/first/packages/ppt-dsl/fixtures/seed-template/ppt_example.pptx"
cmp "$upstream/LICENSE" "$tmp/first/packages/ppt-dsl/LICENSE"
grep -Fq -- "- Commit: [$sha](https://github.com/HYY-yu/ppt-dsl-generator/commit/$sha)" "$tmp/first/packages/ppt-dsl/PROVENANCE.md"

# Fail a retry when an existing branch has unrelated commits in its history.
checkout="$tmp/poisoned"
fresh "$checkout"
printf 'unexpected\n' > "$checkout/unrelated"
git -C "$checkout" -c user.name=Test -c user.email=test@example.test add unrelated
git -C "$checkout" -c user.name=Test -c user.email=test@example.test commit -qm 'unexpected parent'
prepare "$checkout"
git -C "$checkout" push -q origin "HEAD:refs/heads/$branch"
if bash "$sync" publish "$tmp/first" "$sha" >"$tmp/rejected.log" 2>&1; then
  printf 'An unexpected branch was accepted.\n' >&2
  exit 1
fi
grep -Fq 'does not start from SlideLatch main' "$tmp/rejected.log"
test ! -e "$PR_LOG"
git -C "$checkout" push -q origin ":refs/heads/$branch"

# Simulate a successful push followed by an interrupted PR creation.
git -C "$tmp/first" push -q origin "HEAD:refs/heads/$branch"
printf 'main advanced\n' > "$seed/other"
commit "$seed" 'advance main'
git -C "$seed" push -q "$remote" HEAD:main
fresh "$tmp/retry"
prepare "$tmp/retry"
bash "$sync" publish "$tmp/retry" "$sha"
bash "$sync" publish "$tmp/retry" "$sha"
[[ $(cat "$PR_LOG") == opened ]]

# Already merged pins stop before the credentialed step.
git -C "$tmp/retry" push -q origin HEAD:main
fresh "$tmp/pinned"
bash "$sync" prepare "$upstream" "$tmp/pinned" "$sha"
[[ $(cat "$GITHUB_OUTPUT") == 'changed=false' ]]
[[ -z $(git -C "$tmp/pinned" status --porcelain) ]]

# A fresh release branch takes the push path.
rm -f "$PR_RECORD" "$PR_LOG"
printf 'another release\n' >> "$upstream/$runtime/src/new.ts"
commit "$upstream" 'second release'
sha=$(git -C "$upstream" rev-parse HEAD)
fresh "$tmp/new"
prepare "$tmp/new"
bash "$sync" publish "$tmp/new" "$sha"
git -C "$tmp/new" ls-remote --exit-code origin "refs/heads/codex/ppt-dsl-release-$sha" >/dev/null
[[ $(cat "$PR_LOG") == opened ]]
printf 'Release sync smoke tests passed.\n'
