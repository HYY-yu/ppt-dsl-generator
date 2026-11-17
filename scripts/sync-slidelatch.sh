#!/usr/bin/env bash
set -euo pipefail

readonly upstream_repo='HYY-yu/ppt-dsl-generator'
readonly consumer_repo='HYY-yu/SlideLatch'
readonly source_runtime='assets/ppt-node-dsl-project'
readonly snapshot='packages/ppt-dsl'

die() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die 'Expected the full 40-character release commit SHA.'
}

prepare() {
  local upstream=$1 consumer=$2 sha=$3 path
  validate_sha "$sha"
  [[ $(git -C "$upstream" rev-parse HEAD) == "$sha" ]] || die 'Upstream checkout does not match the release SHA.'
  [[ -z $(git -C "$consumer" status --porcelain --untracked-files=all) ]] || die 'SlideLatch checkout must be clean.'

  if git -C "$consumer" show "HEAD:$snapshot/PROVENANCE.md" | grep -Fxq -- "- Commit: [$sha](https://github.com/$upstream_repo/commit/$sha)"; then
    printf 'PPT-DSL %s is already pinned on SlideLatch main.\n' "$sha"
    printf 'changed=false\n' >> "${GITHUB_OUTPUT:?}"
    return
  fi

  for path in "$source_runtime/package.json" "$source_runtime/package-lock.json" LICENSE examples/ppt_example.pptx; do
    git -C "$upstream" cat-file -e "$sha:$path" || die "Release is missing $path."
  done
  if ! git -C "$upstream" ls-tree -r "$sha" -- "$source_runtime" LICENSE examples/ppt_example.pptx |
    awk '$1 != "100644" && $1 != "100755" { exit 1 }'; then
    die 'Runtime snapshot must contain regular tracked files.'
  fi

  git -C "$consumer" rm -qr -- "$snapshot"
  mkdir -p "$consumer/$snapshot"
  git -C "$upstream" archive "$sha:$source_runtime" | tar -x -C "$consumer/$snapshot"
  mkdir -p "$consumer/$snapshot/fixtures/seed-template"
  git -C "$upstream" show "$sha:LICENSE" > "$consumer/$snapshot/LICENSE"
  git -C "$upstream" show "$sha:examples/ppt_example.pptx" > "$consumer/$snapshot/fixtures/seed-template/ppt_example.pptx"
  cat > "$consumer/$snapshot/PROVENANCE.md" <<MARKDOWN
# PPT-DSL runtime provenance

- Upstream: [$upstream_repo](https://github.com/$upstream_repo)
- Commit: [$sha](https://github.com/$upstream_repo/commit/$sha)
- Runtime snapshot: the contents of \`assets/ppt-node-dsl-project/\` at that commit, including its npm lockfile.

\`LICENSE\` comes from upstream's root. \`fixtures/seed-template/ppt_example.pptx\` comes from upstream's \`examples/ppt_example.pptx\` and is used only for tests. A regular SlideLatch checkout contains the snapshot. Its build and CLI use the checked-in source and npm lockfiles.

Submit shared runtime changes and regression tests to upstream first. The release workflow refreshes this snapshot from the published commit and opens a SlideLatch upgrade PR for review. SlideLatch's named page contract and release review live in \`lib/workflow\`. Maintain both Skills independently in their own repositories.
MARKDOWN

  git -C "$consumer" add -f -- "$snapshot"
  git -C "$consumer" -c user.name='PPT-DSL Release Sync' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' -c core.hooksPath=/dev/null \
    commit -m "chore: sync PPT-DSL release ${sha:0:12}"
  printf 'changed=true\n' >> "${GITHUB_OUTPUT:?}"
  printf 'Prepared SlideLatch runtime snapshot at PPT-DSL %s.\n' "$sha"
}

publish() {
  local consumer=$1 sha=$2 branch previous remote_status existing_tree prepared_tree unexpected parents
  validate_sha "$sha"
  [[ -n ${GH_TOKEN:-} ]] || die 'Configure SLIDELATCH_SYNC_TOKEN in ppt-dsl-generator Actions secrets.'
  branch="codex/ppt-dsl-release-$sha"
  previous=$(gh api --method GET "repos/$consumer_repo/pulls" \
    -f state=all -f "head=HYY-yu:$branch" -f base=main --jq '.[0].html_url // empty')
  if [[ -n "$previous" ]]; then
    printf 'Upgrade PR already exists: %s\n' "$previous"
    return
  fi

  if git -C "$consumer" ls-remote --exit-code origin "refs/heads/$branch" >/dev/null; then
    git -C "$consumer" fetch --no-tags origin "refs/heads/$branch"
    existing_tree=$(git -C "$consumer" rev-parse "FETCH_HEAD:$snapshot")
    prepared_tree=$(git -C "$consumer" rev-parse "HEAD:$snapshot")
    parents=$(git -C "$consumer" show -s --format=%P FETCH_HEAD)
    [[ "$parents" =~ ^[0-9a-f]{40}$ ]] &&
      git -C "$consumer" merge-base --is-ancestor "$parents" HEAD^ ||
      die "Existing $branch does not start from SlideLatch main."
    unexpected=$(git -C "$consumer" diff --name-only FETCH_HEAD^ FETCH_HEAD -- . ":(exclude)$snapshot")
    [[ "$existing_tree" == "$prepared_tree" && -z "$unexpected" ]] ||
      die "Existing $branch is not the prepared snapshot. Review it before retrying."
    printf 'Reusing the verified upgrade branch %s.\n' "$branch"
  else
    remote_status=$?
    [[ "$remote_status" == 2 ]] || die "Unable to check the existing upgrade branch (git exit $remote_status)."
    git -C "$consumer" -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
      -c core.hooksPath=/dev/null push origin "HEAD:refs/heads/$branch"
  fi

  GH_REPO="$consumer_repo" gh pr create --base main --head "$branch" \
    --title "chore: sync PPT-DSL release ${sha:0:12}" --body-file - <<MARKDOWN
Sync the checked-in PPT-DSL runtime to the [published commit $sha](https://github.com/$upstream_repo/commit/$sha).

SlideLatch's existing Verify workflow runs on this upgrade PR. Review the snapshot and CI before merging.
MARKDOWN
}

case "${1:-}:$#" in
  prepare:4) prepare "$2" "$3" "$4" ;;
  publish:3) publish "$2" "$3" ;;
  *) die 'Usage: sync-slidelatch.sh prepare <upstream> <consumer> <sha> or publish <consumer> <sha>' ;;
esac
