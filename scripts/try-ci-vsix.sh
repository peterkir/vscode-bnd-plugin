#!/usr/bin/env bash
# Download the VSIX artifact of a GitHub Actions CI run and launch VS Code with it.
set -euo pipefail
IFS=$'\n\t'

readonly DEFAULT_REPO="peterkir/vscode-bnd-plugin"

err() { printf '%s: %s\n' "${0##*/}" "$*" >&2; }
die() { err "$*"; exit 1; }
require_cmd() { command -v "$1" >/dev/null || die "required command not found: $1"; }

usage() {
  cat >&2 <<EOF
Usage: ${0##*/} [options] [RUN_URL|RUN_ID] [FOLDER]

Downloads the VSIX uploaded by a CI run and opens VS Code with it installed.
Without RUN_URL/RUN_ID the latest successful CI run (ci.yml) is used.

Options:
  -R, --repo OWNER/REPO   GitHub repository (default: ${DEFAULT_REPO})
  -b, --branch BRANCH     Branch for "latest successful run" lookup
  -m, --main-profile      Install into your regular VS Code instead of an isolated profile
  -s, --copy-settings     Copy your regular user settings.json into the isolated profile
  -k, --keep              Reuse an existing isolated profile for this run (default: recreate)
  -h, --help              Show this help

Environment:
  CODE                    VS Code CLI to use (default: first */bin/code on PATH; e.g. code-insiders)
  BND_CI_PROFILE_ROOT     Isolated profile root (default: ~/.vscode-bnd-ci)

Examples:
  ${0##*/} https://github.com/${DEFAULT_REPO}/actions/runs/37005804698
  ${0##*/} 37005804698 ~/git/my-bnd-workspace
  ${0##*/} -b main
EOF
  exit 2
}

repo="$DEFAULT_REPO"
branch=""
main_profile=false
copy_settings=false
keep=false
run_ref=""
folder=""

while (($#)); do
  case "$1" in
    -R|--repo) [[ $# -ge 2 ]] || usage; repo="$2"; shift 2 ;;
    -b|--branch) [[ $# -ge 2 ]] || usage; branch="$2"; shift 2 ;;
    -m|--main-profile) main_profile=true; shift ;;
    -s|--copy-settings) copy_settings=true; shift ;;
    -k|--keep) keep=true; shift ;;
    -h|--help) usage ;;
    -*) err "unknown option: $1"; usage ;;
    *)
      if [[ -z "$run_ref" && ( "$1" =~ ^[0-9]+$ || "$1" == *"/actions/runs/"* ) ]]; then
        run_ref="$1"
      elif [[ -z "$folder" ]]; then
        folder="$1"
      else
        usage
      fi
      shift ;;
  esac
done

code_cli="${CODE:-}"
if [[ -z "$code_cli" ]]; then
  # The GUI executable may shadow the CLI wrapper on PATH; it ignores --install-extension.
  while IFS= read -r c; do
    if [[ "$c" == */bin/code || "$c" == */bin/code.cmd ]]; then code_cli="$c"; break; fi
  done < <(type -Pa code code.cmd 2>/dev/null || true)
  code_cli="${code_cli:-code}"
fi
require_cmd gh
require_cmd "$code_cli"
gh auth status -h github.com >/dev/null 2>&1 || die "gh is not authenticated for github.com; run: gh auth login -h github.com"

if [[ -n "$folder" && ! -d "$folder" ]]; then
  die "folder does not exist: $folder"
fi

# Resolve run id from URL, id, or latest successful run.
if [[ "$run_ref" == *"/actions/runs/"* ]]; then
  url_repo="${run_ref#*github.com/}"
  url_repo="${url_repo%%/actions/*}"
  [[ -n "$url_repo" && "$url_repo" != "$run_ref" ]] && repo="$url_repo"
  run_id="${run_ref##*/actions/runs/}"
  run_id="${run_id%%[/?#]*}"
elif [[ -n "$run_ref" ]]; then
  run_id="$run_ref"
else
  list_args=(run list -R "$repo" -w ci.yml -s success -L 1 --json databaseId -q '.[0].databaseId')
  [[ -n "$branch" ]] && list_args+=(-b "$branch")
  run_id="$(gh "${list_args[@]}")"
  [[ -n "$run_id" ]] || die "no successful CI run found in $repo${branch:+ on branch $branch}"
fi
[[ "$run_id" =~ ^[0-9]+$ ]] || die "invalid run id: $run_id"

err "repository: $repo, run: $run_id"
gh run view "$run_id" -R "$repo" --json displayTitle,headBranch,headSha,conclusion \
  -q '"  \(.displayTitle) [\(.headBranch)@\(.headSha[0:7])] conclusion=\(.conclusion)"' >&2

dl_dir="$(mktemp -d)"
cleanup() { rm -rf "$dl_dir"; }
trap cleanup EXIT

# The CI artifact is named after the VSIX file (e.g. bnd-0.12.0.vsix).
gh run download "$run_id" -R "$repo" -p '*.vsix' -D "$dl_dir" \
  || die "artifact download failed (expired after 30 days, or run has no VSIX artifact)"

vsix=""
while IFS= read -r -d '' f; do
  [[ -z "$vsix" ]] || die "multiple VSIX files found in run $run_id"
  vsix="$f"
done < <(find "$dl_dir" -type f -name '*.vsix' -print0)
[[ -n "$vsix" ]] || die "no .vsix file in downloaded artifacts"
err "VSIX: ${vsix##*/}"

code_args=()
if [[ "$main_profile" == false ]]; then
  profile_root="${BND_CI_PROFILE_ROOT:-$HOME/.vscode-bnd-ci}"
  profile_dir="$profile_root/run-$run_id"
  if [[ "$keep" == false && -d "$profile_dir" ]]; then
    rm -rf "$profile_dir"
  fi
  mkdir -p "$profile_dir/user-data/User" "$profile_dir/extensions"

  if [[ "$copy_settings" == true ]]; then
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*) main_user="${APPDATA:?}/Code/User" ;;
      Darwin) main_user="$HOME/Library/Application Support/Code/User" ;;
      *) main_user="${XDG_CONFIG_HOME:-$HOME/.config}/Code/User" ;;
    esac
    if [[ -f "$main_user/settings.json" ]]; then
      cp "$main_user/settings.json" "$profile_dir/user-data/User/settings.json"
    else
      err "no user settings found at $main_user/settings.json; skipping"
    fi
  fi
  settings_file="$profile_dir/user-data/User/settings.json"
  if [[ ! -f "$settings_file" ]]; then
    # Avoid the Copilot/GitHub sign-in prompt in a fresh profile.
    printf '{\n  "chat.disableAIFeatures": true,\n  "workbench.startupEditor": "none"\n}\n' > "$settings_file"
  fi

  code_args=(--user-data-dir "$profile_dir/user-data" --extensions-dir "$profile_dir/extensions")
  err "isolated profile: $profile_dir"
fi

# Keep a copy of the VSIX next to the profile for later inspection/reinstall.
if [[ "$main_profile" == false ]]; then
  cp "$vsix" "$profile_dir/"
  vsix="$profile_dir/${vsix##*/}"
fi

"$code_cli" "${code_args[@]}" --install-extension "$vsix" --force
"$code_cli" "${code_args[@]}" --list-extensions --show-versions | grep -i '^klibio\.bnd@' >&2 \
  || die "extension klibio.bnd not listed after install"

open_args=("${code_args[@]}" --new-window)
[[ -n "$folder" ]] && open_args+=("$folder")
"$code_cli" "${open_args[@]}"
