#!/usr/bin/env bash
# edge-isolation.sh <bridge> <allowed-ip>…      (as root)
# edge-isolation.sh --remove <bridge>
#
# Every tenant's app joins the shared edge network, and Docker lets containers on one bridge reach
# each other. These rules drop container-to-container traffic on that bridge unless one end is an
# allowed address (Traefik, the host agent), so tenant A cannot open tenant B's app directly. The
# reference for the host setup in task 070; the smoke test applies it to its own edge network.
set -euo pipefail

readonly CHAIN=ALIANHUB-EDGE

if [[ ${1:-} == --remove ]]; then
    bridge=${2:?bridge name}
    while iptables -D DOCKER-USER -i "$bridge" -o "$bridge" -j "$CHAIN" 2>/dev/null; do :; done
    iptables -F "$CHAIN" 2>/dev/null || true
    iptables -X "$CHAIN" 2>/dev/null || true
    exit 0
fi

bridge=${1:-}
shift || true
[[ -n $bridge && $# -gt 0 ]] || { echo "usage: $0 <bridge> <allowed-ip>... | --remove <bridge>" >&2; exit 2; }

# Traffic between two containers on one bridge only meets iptables with br_netfilter on.
modprobe br_netfilter 2>/dev/null || true
sysctl -qw net.bridge.bridge-nf-call-iptables=1 2>/dev/null || true

iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
for ip in "$@"; do
    iptables -A "$CHAIN" -s "$ip" -j RETURN
    iptables -A "$CHAIN" -d "$ip" -j RETURN
done
iptables -A "$CHAIN" -j DROP
iptables -C DOCKER-USER -i "$bridge" -o "$bridge" -j "$CHAIN" 2>/dev/null ||
    iptables -I DOCKER-USER -i "$bridge" -o "$bridge" -j "$CHAIN"
