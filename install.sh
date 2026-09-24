#!/usr/bin/env bash
#
# NetMon — bootstrap de instalação.
#
# Uso (como root, num Ubuntu/Debian):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/raianwp/netmon-network-hub/main/install.sh)"
#
# NÃO use "curl ... | bash" — a forma acima (bash -c "$(curl ...)") é
# necessária porque o netmon.sh pede confirmação interativa (ENTER, s/N,
# etc.) durante a instalação; com "curl | bash" o stdin do script fica
# preso no pipe do curl e essas perguntas nunca recebem resposta.
#
# O que este script faz: garante git/curl instalados, clona a última tag
# de release do repositório público do NetMon numa pasta local e entrega
# o controle pro netmon.sh (o instalador/atualizador de verdade, com seu
# próprio menu interativo) — não reimplementa nada da instalação em si.

set -euo pipefail

REPO_URL="https://github.com/raianwp/netmon-network-hub.git"
CLONE_DIR="/tmp/netmon-network-hub"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}${BOLD}[x] Execute como root:${NC} sudo bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/raianwp/netmon-network-hub/main/install.sh)\""
  exit 1
fi

echo -e "${CYAN}${BOLD}NetMon — bootstrap de instalação${NC}"

if ! command -v git &>/dev/null || ! command -v curl &>/dev/null; then
  echo "  Instalando git/curl..."
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates
fi

echo "  Buscando a última versão publicada..."
LATEST_TAG="$(git ls-remote --tags --refs "$REPO_URL" | awk -F/ '{print $NF}' | sort -V | tail -1)"

if [[ -z "$LATEST_TAG" ]]; then
  echo -e "${RED}[x] Não foi possível encontrar nenhuma tag de release no repositório.${NC}"
  exit 1
fi

echo -e "  Última versão: ${GREEN}${LATEST_TAG}${NC}"

rm -rf "$CLONE_DIR"
echo "  Clonando em ${CLONE_DIR}..."
git clone --quiet --branch "$LATEST_TAG" --depth 1 "$REPO_URL" "$CLONE_DIR"

echo -e "${GREEN}${BOLD}[OK] Pronto. Iniciando o instalador do NetMon...${NC}"
echo

cd "$CLONE_DIR"
exec bash netmon.sh
