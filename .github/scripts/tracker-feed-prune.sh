#!/usr/bin/env bash
# tracker-feed-prune.sh <feedDir> <version> <keep>
#
# Run on the downloads server by .github/workflows/tracker-release.yml after each upload. Records
# <version> in <feedDir>/versions.txt and deletes the installers of every version older than the
# newest <keep>. latest*.yml and the current SHA256SUMS are never touched.
#
# The feed stays flat (installers beside latest*.yml) because the instances' download links
# (Modules/DesktopTracker/feed.js) and the updater expect file names directly under the channel.
# A file belongs to version V when its name has "-V" followed by "." or "-" and a letter, as in
# AlianHub-Tracker-Setup-V.exe, AlianHub-Tracker-V-universal.dmg, AlianHub-Tracker-V-amd64.deb.
set -euo pipefail

dir=$1 version=$2 keep=$3
cd "$dir"

# The three platform jobs upload and prune at the same time.
exec 9>.prune.lock
flock 9

touch versions.txt
{ cat versions.txt; printf '%s\n' "$version"; } | grep -v '^$' | sort -uV >versions.txt.new
mapfile -t all <versions.txt.new
rm -f versions.txt.new

drop=$(( ${#all[@]} - keep ))
(( drop > 0 )) || drop=0
shopt -s nullglob
for old in "${all[@]:0:drop}"; do
    for file in *; do
        if [[ $file == *-"$old".[A-Za-z]* || $file == *-"$old"-[A-Za-z]* ]]; then
            rm -f -- "$file"
            echo "removed $file"
        fi
    done
done

printf '%s\n' "${all[@]:drop}" >versions.txt
echo "kept: ${all[*]:drop}"
