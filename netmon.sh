#!/usr/bin/env bash
# =============================================================================
#  NetMon — Gerenciador Unificado
#  Instalar · Atualizar · HTTPS · Resetar Admin · Status
#
#  Execute como root a partir da pasta extraída do ZIP:
#    sudo bash netmon.sh
# =============================================================================

set -euo pipefail

# ── Cores ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Funções utilitárias ────────────────────────────────────────────────────────
step()  { echo -e "\n${BLUE}${BOLD}[→]${NC} ${BOLD}$*${NC}"; }
ok()    { echo -e "    ${GREEN}✓${NC} $*"; }
warn()  { echo -e "    ${YELLOW}⚠${NC}  $*"; }
fail()  { echo -e "\n${RED}${BOLD}[✗] ERRO:${NC} $*\n"; exit 1; }
sep()   { echo -e "  ${DIM}──────────────────────────────────────────────────────────────────${NC}"; }

# ── Constantes ─────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/netmon"
SERVICE_USER="netmon"
SSL_DIR="/etc/netmon/ssl"
CERT_FILE="${SSL_DIR}/netmon.crt"
KEY_FILE="${SSL_DIR}/netmon.key"

# ── Verificar root ─────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}${BOLD}[✗] Execute como root: sudo bash netmon.sh${NC}"
  exit 1
fi

# ── Detectar IP do servidor ────────────────────────────────────────────────────
detect_ip() {
  SERVER_IP="$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+' | head -1 || true)"
  if [[ -z "${SERVER_IP:-}" ]]; then
    SERVER_IP="$(hostname -I | awk '{print $1}')"
  fi
}

# ── Banner ─────────────────────────────────────────────────────────────────────
show_banner() {
  clear
  echo -e "${CYAN}${BOLD}"
  echo "  ███╗   ██╗███████╗████████╗███╗   ███╗ ██████╗ ███╗   ██╗"
  echo "  ████╗  ██║██╔════╝╚══██╔══╝████╗ ████║██╔═══██╗████╗  ██║"
  echo "  ██╔██╗ ██║█████╗     ██║   ██╔████╔██║██║   ██║██╔██╗ ██║"
  echo "  ██║╚██╗██║██╔══╝     ██║   ██║╚██╔╝██║██║   ██║██║╚██╗██║"
  echo "  ██║ ╚████║███████╗   ██║   ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║"
  echo "  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝"
  echo -e "${NC}"
  echo -e "  ${DIM}Desenvolvido por Raian William${NC}"
  echo ""
}

# ── Detectar versão do app a partir de um checkout (origem ou instalado) ───────
detect_app_version() {
  local dir="$1"
  local file="${dir}/artifacts/api-server/src/routes/system.ts"
  [[ -f "$file" ]] || { echo ""; return; }
  grep -oP "appVersion:\s*['\"]\K[0-9]+\.[0-9]+(\.[0-9]+)?" "$file" 2>/dev/null | head -1
}

# ── Voltar ao menu ─────────────────────────────────────────────────────────────
press_enter_menu() {
  echo ""
  read -rp "  Pressione ENTER para voltar ao menu..."
  show_menu
}

# =============================================================================
#  MENU PRINCIPAL
# =============================================================================
show_menu() {
  detect_ip
  show_banner

  local installed=false
  [[ -f "${INSTALL_DIR}/.env" ]] && installed=true

  if $installed; then
    # Detectar se HTTPS já está ativo
    local https_status=""
    if nginx -T 2>/dev/null | grep -q "listen 443"; then
      https_status=" ${DIM}(ativo)${NC}"
    fi

    # Detectar versão instalada
    local version=""
    version="$(detect_app_version "${INSTALL_DIR}")"
    [[ -n "$version" ]] && version=" ${DIM}v${version}${NC}"

    # Status do serviço
    local svc_color="$GREEN"
    local svc_label="rodando"
    if ! systemctl is-active --quiet netmon 2>/dev/null; then
      svc_color="$RED"
      svc_label="parado"
    fi

    echo -e "  Instalação encontrada em ${CYAN}${INSTALL_DIR}${NC}${version}"
    echo -e "  Serviço: ${svc_color}${BOLD}● ${svc_label}${NC}    IP: ${CYAN}${SERVER_IP}${NC}"
    echo ""
    sep
    echo ""
    echo -e "  ${BOLD}1)${NC} Atualizar NetMon          ${DIM}— aplica nova versão, preserva banco e config${NC}"
    echo -e "  ${BOLD}2)${NC} Ativar / Renovar HTTPS    ${DIM}— certificado autoassinado para notificações${NC}${https_status}"
    echo -e "  ${BOLD}3)${NC} Resetar senha admin       ${DIM}— redefine login admin com senha padrão${NC}"
    echo -e "  ${BOLD}4)${NC} Status do serviço         ${DIM}— mostra logs e informações em tempo real${NC}"
    echo -e "  ${BOLD}5)${NC} Reinstalar do zero        ${DIM}— ${RED}apaga banco e configurações${NC}"
    echo -e "  ${BOLD}6)${NC} Restaurar Backup          ${DIM}— substitui o banco atual por um arquivo .sql${NC}"
    echo -e "  ${BOLD}0)${NC} Sair"
    echo ""
    sep
    echo ""
    read -rp "  Escolha uma opção: " CHOICE
    echo ""

    case "${CHOICE}" in
      1) cmd_update ;;
      2) cmd_https ;;
      3) cmd_reset_admin ;;
      4) cmd_status ;;
      5) cmd_reinstall ;;
      6) cmd_restore_backup ;;
      0) echo -e "  ${DIM}Saindo...${NC}\n"; exit 0 ;;
      *) echo -e "  ${RED}Opção inválida.${NC}"; sleep 1; show_menu ;;
    esac
  else
    echo -e "  ${YELLOW}⚠${NC}  Nenhuma instalação encontrada em ${CYAN}${INSTALL_DIR}${NC}"
    echo ""
    sep
    echo ""
    echo -e "  ${BOLD}1)${NC} Instalar NetMon"
    echo -e "  ${BOLD}0)${NC} Sair"
    echo ""
    sep
    echo ""
    read -rp "  Escolha uma opção: " CHOICE
    echo ""

    case "${CHOICE}" in
      1) cmd_install ;;
      0) echo -e "  ${DIM}Saindo...${NC}\n"; exit 0 ;;
      *) echo -e "  ${RED}Opção inválida.${NC}"; sleep 1; show_menu ;;
    esac
  fi
}

# =============================================================================
#  1. INSTALAR
# =============================================================================
cmd_install() {
  # Verificar que está na pasta correta
  if [[ ! -f "package.json" ]] || [[ ! -d "artifacts/netmon" ]]; then
    echo -e "  ${RED}${BOLD}[✗] Execute este script a partir da raiz do projeto NetMon${NC}"
    echo -e "      (pasta extraída do ZIP que contém package.json + artifacts/)"
    press_enter_menu
    return
  fi

  local PROJECT_DIR
  PROJECT_DIR="$(pwd)"
  local DB_NAME="netmon"
  local DB_USER="netmon"
  local DB_PASS
  DB_PASS="$(openssl rand -hex 16)"
  local SESSION_SECRET
  SESSION_SECRET="$(openssl rand -hex 32)"
  local DEFAULT_LOGIN="admin"
  local DEFAULT_PASS="admin123"

  local install_version
  install_version="$(detect_app_version "${PROJECT_DIR}")"

  show_banner
  echo -e "  ${BOLD}Instalação do NetMon${NC}"
  echo ""
  echo -e "  Versão  : ${CYAN}${BOLD}v${install_version:-desconhecida}${NC}"
  echo -e "  Origem  : ${CYAN}${PROJECT_DIR}${NC}"
  echo -e "  Destino : ${CYAN}${INSTALL_DIR}${NC}"
  echo -e "  IP      : ${CYAN}${SERVER_IP}${NC}"
  echo ""
  sep
  echo ""
  read -rp "  Pressione ENTER para iniciar a instalação..."

  # ── Dependências do sistema ──────────────────────────────────────────────────
  step "Atualizando pacotes do sistema..."
  apt-get update -qq
  ok "Lista de pacotes atualizada"

  step "Instalando dependências do sistema..."
  apt-get install -y -qq \
    curl wget git build-essential \
    iputils-ping net-tools \
    nginx \
    postgresql postgresql-contrib \
    openssl ca-certificates \
    rsync unzip
  ok "Dependências instaladas"

  step "Instalando Node.js 20 LTS..."
  if ! command -v node &>/dev/null || [[ "$(node --version | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
    apt-get install -y -qq nodejs
  fi
  ok "Node.js $(node --version) instalado"

  step "Instalando pnpm..."
  if ! command -v pnpm &>/dev/null; then
    npm install -g pnpm --silent
  fi
  ok "pnpm $(pnpm --version) instalado"

  # ── PostgreSQL ───────────────────────────────────────────────────────────────
  step "Configurando PostgreSQL..."
  systemctl enable postgresql --quiet
  systemctl start postgresql

  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null || \
    sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null || true
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" 2>/dev/null || true
  ok "Banco de dados '${DB_NAME}' configurado"

  # ── Usuário do sistema ───────────────────────────────────────────────────────
  step "Criando usuário do sistema '${SERVICE_USER}'..."
  if ! id "${SERVICE_USER}" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi
  ok "Usuário de serviço '${SERVICE_USER}' pronto"

  # ── Copiar arquivos ──────────────────────────────────────────────────────────
  step "Copiando projeto para ${INSTALL_DIR}..."
  mkdir -p "${INSTALL_DIR}"
  rsync -a --exclude='.git' --exclude='node_modules' \
    "${PROJECT_DIR}/" "${INSTALL_DIR}/"
  ok "Arquivos copiados"

  # ── .env ────────────────────────────────────────────────────────────────────
  step "Criando arquivo de ambiente (.env)..."
  cat > "${INSTALL_DIR}/.env" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
NODE_ENV=production
PORT=8080
EOF
  chmod 600 "${INSTALL_DIR}/.env"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/.env" 2>/dev/null || true
  ok ".env criado com credenciais seguras"

  # ── Node deps ────────────────────────────────────────────────────────────────
  step "Instalando dependências Node (pnpm install)..."
  cd "${INSTALL_DIR}"
  pnpm install --frozen-lockfile --silent
  ok "Dependências instaladas"

  # ── Schema ──────────────────────────────────────────────────────────────────
  # `yes |` auto-answers any confirmation prompt drizzle-kit push might show
  # (e.g. "new column or renamed from another column?") — without it, a prompt
  # left unanswered inside a non-interactive pipe silently stalls/skips the
  # push, leaving tables/columns missing (this is exactly what broke login on
  # fresh installs before: the schema wasn't fully applied, so the admin seed
  # below failed against a table that didn't match).
  step "Criando tabelas no banco de dados..."
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
  ( yes 2>/dev/null || true ) | pnpm --filter @workspace/db run push 2>&1 | tail -20
  ok "Schema aplicado"

  # ── Seed admin ───────────────────────────────────────────────────────────────
  step "Criando usuário admin padrão..."
  if ! python3 -c "import bcrypt" &>/dev/null; then
    apt-get install -y -qq python3-bcrypt
  fi
  local ADMIN_HASH
  ADMIN_HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw(b'admin123', bcrypt.gensalt(10)).decode())")

  sudo -u postgres psql -v ON_ERROR_STOP=1 "${DB_NAME}" <<SQL
INSERT INTO users (username, password_hash)
VALUES ('admin', '${ADMIN_HASH}')
ON CONFLICT (username) DO UPDATE SET password_hash = '${ADMIN_HASH}';
SQL
  ok "Usuário admin criado (senha padrão: admin123)"

  # ── Build ────────────────────────────────────────────────────────────────────
  step "Compilando backend (API)..."
  pnpm --filter @workspace/api-server run build 2>&1 | tail -3
  ok "Backend compilado"

  step "Compilando frontend (React)..."
  NODE_ENV=production BASE_PATH=/ PORT=3000 \
    pnpm --filter @workspace/netmon run build 2>&1 | tail -5
  ok "Frontend compilado"

  # ── Systemd ──────────────────────────────────────────────────────────────────
  step "Criando serviço systemd (netmon.service)..."
  cat > /etc/systemd/system/netmon.service <<EOF
[Unit]
Description=NetMon - Network Monitor API Server
After=network.target postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=netmon
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable netmon --quiet
  systemctl restart netmon
  sleep 2

  if systemctl is-active --quiet netmon; then
    ok "Serviço netmon iniciado e habilitado no boot"
  else
    warn "Serviço pode estar com problema. Cheque: sudo journalctl -u netmon -n 50"
  fi

  # ── SSL + Nginx ──────────────────────────────────────────────────────────────
  _gen_ssl
  _config_nginx
  _config_firewall

  # ── Permissões ───────────────────────────────────────────────────────────────
  step "Ajustando permissões..."
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}" 2>/dev/null || true
  chown -R www-data:www-data "${INSTALL_DIR}/artifacts/netmon/dist/public" 2>/dev/null || true
  ok "Permissões ajustadas"

  # ── Resumo ───────────────────────────────────────────────────────────────────
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════════════╗"
  echo "  ║           ✅  NETMON INSTALADO COM SUCESSO!                     ║"
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-20s ${NC}${BOLD}https://${SERVER_IP}${CYAN}${BOLD}%-$((46 - ${#SERVER_IP}))s║\n" "🔒  Acesso web :"  ""
  printf "  ║  %-20s ${NC}${BOLD}${DEFAULT_LOGIN}${CYAN}${BOLD}%-$((46 - ${#DEFAULT_LOGIN}))s║\n" "👤  Login padrão :"  ""
  printf "  ║  %-20s ${NC}${BOLD}${DEFAULT_PASS}${CYAN}${BOLD}%-$((46 - ${#DEFAULT_PASS}))s║\n" "🔑  Senha padrão :"  ""
  printf "  ║  %-66s║\n" ""
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-66s║\n" "  ⚠️  Troque a senha em: Configurações → Gerenciar Usuários"
  printf "  ║  %-66s║\n" ""
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-66s║\n" "  🔒 Primeiro acesso — aviso de cert. autoassinado no Chrome:"
  printf "  ║  %-66s║\n" "     Clique em 'Avançado' → 'Acessar ${SERVER_IP} mesmo assim'"
  printf "  ║  %-66s║\n" "     Feito UMA vez — depois notificações Windows funcionam."
  printf "  ║  %-66s║\n" ""
  echo -e "  ╚══════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  echo ""
  warn "Em instalações do zero, o login pode falhar até o servidor ser reiniciado."
  read -rp "  Deseja reiniciar o servidor agora? [s/N] " CONFIRM_REBOOT
  if [[ "${CONFIRM_REBOOT,,}" == "s" ]]; then
    echo -e "\n  ${CYAN}Reiniciando o servidor...${NC}"
    reboot
    exit 0
  fi

  press_enter_menu
}

# =============================================================================
#  2. ATUALIZAR
# =============================================================================
cmd_update() {
  if [[ ! -f "package.json" ]] || [[ ! -d "artifacts/netmon" ]]; then
    echo -e "  ${RED}${BOLD}[✗] Execute a partir da raiz do projeto NetMon (pasta do ZIP).${NC}"
    press_enter_menu
    return
  fi

  local PROJECT_DIR
  PROJECT_DIR="$(pwd)"

  local current_version new_version
  current_version="$(detect_app_version "${INSTALL_DIR}")"
  new_version="$(detect_app_version "${PROJECT_DIR}")"

  show_banner
  echo -e "  ${BOLD}Atualização do NetMon${NC}"
  echo ""
  echo -e "  Versão atual : ${CYAN}v${current_version:-desconhecida}${NC}"
  echo -e "  Nova versão  : ${CYAN}${BOLD}v${new_version:-desconhecida}${NC}"
  echo -e "  Origem       : ${CYAN}${PROJECT_DIR}${NC}"
  echo -e "  Destino      : ${CYAN}${INSTALL_DIR}${NC}"
  echo ""
  echo -e "  ${YELLOW}⚠  O serviço ficará fora por alguns segundos durante o rebuild.${NC}"
  echo -e "  ${YELLOW}   Banco de dados e arquivo .env não serão alterados.${NC}"
  echo ""
  sep
  echo ""
  read -rp "  Pressione ENTER para iniciar a atualização..."

  step "Copiando arquivos novos (preservando .env e banco de dados)..."
  rsync -a \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.env' \
    "${PROJECT_DIR}/" "${INSTALL_DIR}/"
  ok "Arquivos atualizados"

  step "Instalando/atualizando dependências Node..."
  cd "${INSTALL_DIR}"
  pnpm install --frozen-lockfile --silent
  ok "Dependências atualizadas"

  # `yes |` auto-answers any confirmation prompt drizzle-kit push might show —
  # without it, an unanswered prompt inside this pipe silently stalls/skips
  # the push, leaving new tables/columns missing after the "update".
  step "Aplicando migrações do banco de dados (se houver novas tabelas/colunas)..."
  set -a; source "${INSTALL_DIR}/.env"; set +a
  ( yes 2>/dev/null || true ) | pnpm --filter @workspace/db run push 2>&1 | tail -20
  ok "Schema do banco verificado"

  step "Compilando backend (API)..."
  pnpm --filter @workspace/api-server run build 2>&1 | tail -3
  ok "Backend compilado"

  step "Compilando frontend (React)..."
  NODE_ENV=production BASE_PATH=/ PORT=3000 \
    pnpm --filter @workspace/netmon run build 2>&1 | tail -5
  ok "Frontend compilado"

  if [[ -f "${CERT_FILE}" ]]; then
    step "Atualizando configuração do Nginx (proxy WebSocket do IA Terminal)..."
    _config_nginx
  fi

  step "Ajustando permissões..."
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}" 2>/dev/null || true
  chown -R www-data:www-data "${INSTALL_DIR}/artifacts/netmon/dist/public" 2>/dev/null || true
  ok "Permissões ajustadas"

  step "Reiniciando serviço NetMon..."
  systemctl daemon-reload
  systemctl restart netmon
  sleep 2

  if systemctl is-active --quiet netmon; then
    ok "Serviço reiniciado com sucesso"
  else
    warn "Serviço com problema. Verifique: sudo journalctl -u netmon -n 50"
  fi

  # Detectar protocolo (http ou https)
  local proto="http"
  nginx -T 2>/dev/null | grep -q "listen 443" && proto="https"

  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════════════╗"
  echo "  ║           ✅  NETMON ATUALIZADO COM SUCESSO!                    ║"
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-20s ${NC}${BOLD}${proto}://${SERVER_IP}${CYAN}${BOLD}%-$((46 - ${#SERVER_IP} - ${#proto} + 4))s║\n" "🌐  Acesso web :"  ""
  printf "  ║  %-66s║\n" "  ✅  Banco de dados e usuários preservados"
  printf "  ║  %-66s║\n" "  ✅  Configurações do .env mantidas"
  printf "  ║  %-66s║\n" ""
  echo -e "  ╚══════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  press_enter_menu
}

# =============================================================================
#  3. ATIVAR / RENOVAR HTTPS
# =============================================================================
cmd_https() {
  show_banner
  echo -e "  ${BOLD}Ativar / Renovar HTTPS${NC}"
  echo ""
  echo -e "  IP detectado   : ${CYAN}${SERVER_IP}${NC}"
  echo -e "  Hostname       : ${CYAN}$(hostname)${NC}"
  echo -e "  Validade       : ${CYAN}10 anos${NC}"
  echo -e "  Cert salvo em  : ${CYAN}${CERT_FILE}${NC}"
  echo ""

  # Alertar se já existe cert
  if [[ -f "${CERT_FILE}" ]]; then
    local expires
    expires="$(openssl x509 -noout -enddate -in "${CERT_FILE}" 2>/dev/null | cut -d= -f2 || echo 'desconhecido')"
    echo -e "  ${YELLOW}⚠  Certificado existente válido até: ${expires}${NC}"
    echo -e "  ${YELLOW}   Continuar irá gerar e instalar um novo certificado.${NC}"
    echo ""
  fi

  sep
  echo ""
  read -rp "  Pressione ENTER para continuar (ou Ctrl+C para cancelar)..."

  # ── Verificar dependências ───────────────────────────────────────────────────
  step "Verificando dependências..."
  command -v openssl &>/dev/null || fail "openssl não encontrado. Instale: apt install openssl"
  command -v nginx   &>/dev/null || fail "nginx não encontrado."
  ok "Dependências OK"

  # ── Gerar certificado ────────────────────────────────────────────────────────
  _gen_ssl

  # ── Nginx ────────────────────────────────────────────────────────────────────
  _config_nginx

  # ── Firewall ─────────────────────────────────────────────────────────────────
  _config_firewall

  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════════════╗"
  echo "  ║           ✅  HTTPS ATIVADO COM SUCESSO!                        ║"
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-20s ${NC}${BOLD}https://${SERVER_IP}${CYAN}${BOLD}%-$((46 - ${#SERVER_IP}))s║\n" "🔒  Acesso web :"  ""
  printf "  ║  %-66s║\n" ""
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-66s║\n" "  ⚠️  Primeiro acesso — aviso de certificado no Chrome:"
  printf "  ║  %-66s║\n" "     Clique em 'Avançado' → 'Acessar ${SERVER_IP} mesmo assim'"
  printf "  ║  %-66s║\n" "     Feito UMA vez — depois notificações Windows funcionam."
  printf "  ║  %-66s║\n" ""
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-66s║\n" "  📋 Certificado para instalar no Windows (remove aviso do Chrome):"
  printf "  ║  %-66s║\n" "     ${CERT_FILE}"
  printf "  ║  %-66s║\n" "     Copie o .crt e instale em:"
  printf "  ║  %-66s║\n" "     Gerenciar Certificados → Autoridades Raiz Confiáveis"
  printf "  ║  %-66s║\n" ""
  echo -e "  ╚══════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  press_enter_menu
}

# =============================================================================
#  4. RESETAR SENHA ADMIN
# =============================================================================
cmd_reset_admin() {
  show_banner
  echo -e "  ${BOLD}Resetar Senha do Admin${NC}"
  echo ""
  echo -e "  Este script irá ${YELLOW}criar ou redefinir${NC} o usuário ${BOLD}admin${NC}"
  echo -e "  com a senha padrão ${BOLD}admin123${NC}."
  echo ""
  sep
  echo ""
  read -rp "  Continuar? [s/N] " CONFIRM
  if [[ "${CONFIRM,,}" != "s" ]]; then
    echo -e "\n  ${YELLOW}Cancelado.${NC}"
    press_enter_menu
    return
  fi

  # Carregar DATABASE_URL do .env
  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    fail "Arquivo .env não encontrado em ${INSTALL_DIR}/.env"
  fi
  set -a; source "${INSTALL_DIR}/.env"; set +a

  if [[ -z "${DATABASE_URL:-}" ]]; then
    fail "DATABASE_URL não encontrado no .env"
  fi

  echo ""
  step "Gerando hash bcrypt da senha..."

  local HASH=""

  # Tentar Python primeiro
  if python3 -c "import bcrypt" &>/dev/null 2>&1; then
    HASH=$(python3 -c "
import bcrypt
pw = b'admin123'
h = bcrypt.hashpw(pw, bcrypt.gensalt(10))
print(h.decode())
" 2>/dev/null)
  fi

  # Fallback Node.js
  if [[ -z "${HASH}" ]]; then
    warn "python3-bcrypt não disponível. Tentando via Node.js..."
    HASH=$(node -e "
const bcrypt = require('bcryptjs');
console.log(bcrypt.hashSync('admin123', 10));
" 2>/dev/null || true)
  fi

  if [[ -z "${HASH}" ]]; then
    fail "Não foi possível gerar o hash. Instale: apt install python3-bcrypt"
  fi
  ok "Hash bcrypt gerado"

  step "Atualizando banco de dados..."
  psql "${DATABASE_URL}" <<SQL
INSERT INTO users (username, password_hash, created_at)
VALUES ('admin', '${HASH}', NOW())
ON CONFLICT (username) DO UPDATE
  SET password_hash = EXCLUDED.password_hash;
SQL
  ok "Banco atualizado"

  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════════════╗"
  echo "  ║           ✅  SENHA DO ADMIN REDEFINIDA!                        ║"
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-20s ${NC}${BOLD}admin${CYAN}${BOLD}%-41s║\n" "👤  Usuário :"  ""
  printf "  ║  %-20s ${NC}${BOLD}admin123${CYAN}${BOLD}%-38s║\n" "🔑  Senha :"  ""
  printf "  ║  %-66s║\n" ""
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-66s║\n" "  ⚠️  Troque a senha imediatamente após fazer login!"
  printf "  ║  %-66s║\n" "     Configurações → Controle de Acesso → ícone de chave"
  printf "  ║  %-66s║\n" ""
  echo -e "  ╚══════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  press_enter_menu
}

# =============================================================================
#  5. STATUS DO SERVIÇO
# =============================================================================
cmd_status() {
  show_banner
  echo -e "  ${BOLD}Status do NetMon${NC}"
  echo ""

  # Status systemd
  local svc_active
  svc_active="$(systemctl is-active netmon 2>/dev/null || echo 'inativo')"
  local svc_enabled
  svc_enabled="$(systemctl is-enabled netmon 2>/dev/null || echo 'desabilitado')"

  local proto="http"
  nginx -T 2>/dev/null | grep -q "listen 443" && proto="https"

  if [[ "${svc_active}" == "active" ]]; then
    echo -e "  Serviço  : ${GREEN}${BOLD}● rodando${NC}"
  else
    echo -e "  Serviço  : ${RED}${BOLD}● ${svc_active}${NC}"
  fi
  echo -e "  Boot     : ${svc_enabled}"
  echo -e "  Acesso   : ${CYAN}${proto}://${SERVER_IP}${NC}"

  # Cert SSL
  if [[ -f "${CERT_FILE}" ]]; then
    local expires
    expires="$(openssl x509 -noout -enddate -in "${CERT_FILE}" 2>/dev/null | cut -d= -f2 || echo 'desconhecido')"
    echo -e "  Cert SSL : válido até ${CYAN}${expires}${NC}"
  else
    echo -e "  Cert SSL : ${YELLOW}não configurado${NC}"
  fi

  echo ""
  sep
  echo ""
  echo -e "  ${BOLD}Últimas 20 linhas de log:${NC}"
  echo ""
  journalctl -u netmon -n 20 --no-pager --output=short 2>/dev/null || \
    echo -e "  ${YELLOW}Logs não disponíveis.${NC}"

  echo ""
  sep
  echo ""
  echo -e "  ${BOLD}Comandos rápidos:${NC}"
  echo -e "  ${DIM}sudo systemctl restart netmon    → reiniciar serviço${NC}"
  echo -e "  ${DIM}sudo journalctl -u netmon -f     → logs em tempo real${NC}"
  echo -e "  ${DIM}sudo systemctl stop netmon       → parar serviço${NC}"
  echo ""

  press_enter_menu
}

# =============================================================================
#  6. REINSTALAR DO ZERO
# =============================================================================
cmd_reinstall() {
  show_banner
  echo -e "  ${RED}${BOLD}⚠  REINSTALAÇÃO COMPLETA${NC}"
  echo ""
  echo -e "  ${RED}Esta operação irá:${NC}"
  echo -e "   • Parar e remover o serviço NetMon"
  echo -e "   • Apagar todos os arquivos em ${INSTALL_DIR}"
  echo -e "   • Apagar o banco de dados PostgreSQL e todos os dados"
  echo -e "   • Remover o certificado SSL existente"
  echo -e "   • Instalar tudo do zero"
  echo ""
  echo -e "  ${RED}${BOLD}NÃO há como recuperar os dados após isso.${NC}"
  echo ""
  sep
  echo ""
  read -rp "  Tem certeza? Digite 'sim' para confirmar: " CONFIRM

  if [[ "${CONFIRM}" != "sim" ]]; then
    echo -e "\n  ${YELLOW}Cancelado.${NC}"
    press_enter_menu
    return
  fi

  step "Parando e removendo serviço..."
  systemctl stop netmon 2>/dev/null || true
  systemctl disable netmon 2>/dev/null || true
  rm -f /etc/systemd/system/netmon.service
  systemctl daemon-reload
  ok "Serviço removido"

  step "Removendo arquivos de instalação..."
  rm -rf "${INSTALL_DIR}"
  ok "Diretório ${INSTALL_DIR} removido"

  step "Removendo banco de dados PostgreSQL..."
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS netmon;" 2>/dev/null || true
  sudo -u postgres psql -c "DROP USER IF EXISTS netmon;"     2>/dev/null || true
  ok "Banco de dados removido"

  step "Removendo certificado SSL..."
  rm -rf "${SSL_DIR}"
  ok "Certificado SSL removido"

  echo ""
  echo -e "  ${GREEN}Limpeza concluída. Iniciando instalação do zero...${NC}"
  sleep 2

  cmd_install
}

# =============================================================================
#  7. RESTAURAR BACKUP
# =============================================================================
cmd_restore_backup() {
  show_banner
  echo -e "  ${BOLD}Restaurar Backup${NC}"
  echo ""

  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    fail "Nenhuma instalação encontrada em ${INSTALL_DIR}. Instale o NetMon primeiro."
  fi

  local PROJECT_DIR
  PROJECT_DIR="$(pwd)"
  local backup_dir="${PROJECT_DIR}/backups"
  mkdir -p "${backup_dir}"

  # Lista todo .sql dentro da pasta de backups — tanto os gerados automaticamente
  # pelo próprio NetMon (netmon_backup_*.sql) quanto qualquer arquivo que o
  # usuário copie manualmente para lá.
  local sql_files=()
  while IFS= read -r -d '' f; do sql_files+=("$f"); done \
    < <(find "${backup_dir}" -maxdepth 1 -type f -name "*.sql" -print0 | sort -zr)

  if [[ ${#sql_files[@]} -eq 0 ]]; then
    echo -e "  ${YELLOW}⚠  Nenhum arquivo .sql encontrado em:${NC}"
    echo -e "     ${CYAN}${backup_dir}${NC}"
    echo ""
    echo -e "  Copie o arquivo de backup (.sql) para essa pasta e tente de novo."
    press_enter_menu
    return
  fi

  echo -e "  Arquivos .sql encontrados em ${CYAN}${backup_dir}${NC}:"
  echo ""
  local i=1
  for f in "${sql_files[@]}"; do
    printf "  ${BOLD}%d)${NC} %s  ${DIM}(%s)${NC}\n" "$i" "$(basename "$f")" "$(du -h "$f" | cut -f1)"
    i=$((i + 1))
  done
  echo -e "  ${BOLD}0)${NC} Cancelar"
  echo ""
  sep
  echo ""
  read -rp "  Escolha o arquivo para restaurar: " FILE_CHOICE

  if [[ "${FILE_CHOICE}" == "0" || -z "${FILE_CHOICE}" ]]; then
    echo -e "\n  ${YELLOW}Cancelado.${NC}"
    press_enter_menu
    return
  fi
  if ! [[ "${FILE_CHOICE}" =~ ^[0-9]+$ ]] || (( FILE_CHOICE < 1 || FILE_CHOICE > ${#sql_files[@]} )); then
    echo -e "\n  ${RED}Opção inválida.${NC}"
    press_enter_menu
    return
  fi
  local restore_file="${sql_files[$((FILE_CHOICE - 1))]}"

  echo ""
  echo -e "  ${RED}${BOLD}⚠  Isso vai substituir TODO o banco de dados atual${NC} pelo conteúdo de:"
  echo -e "     ${CYAN}$(basename "${restore_file}")${NC}"
  echo -e "  ${RED}Os dados atuais (hosts, usuários, configurações) serão perdidos.${NC}"
  echo -e "  ${DIM}O arquivo .env (credenciais de banco) não é alterado.${NC}"
  echo ""
  read -rp "  Tem certeza? Digite 'sim' para confirmar: " CONFIRM
  if [[ "${CONFIRM}" != "sim" ]]; then
    echo -e "\n  ${YELLOW}Cancelado.${NC}"
    press_enter_menu
    return
  fi

  step "Parando serviço NetMon..."
  systemctl stop netmon 2>/dev/null || true
  ok "Serviço parado"

  step "Recriando banco de dados vazio..."
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS netmon;" >/dev/null
  sudo -u postgres psql -c "CREATE DATABASE netmon OWNER netmon;" >/dev/null
  ok "Banco 'netmon' recriado (usuário/senha do banco não mudam)"

  step "Restaurando dump (${backup_dir##*/}/$(basename "${restore_file}"))..."
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d netmon < "${restore_file}"
  ok "Dump restaurado"

  step "Atualizando schema para a versão instalada (tabelas/colunas novas)..."
  cd "${INSTALL_DIR}"
  set -a; source "${INSTALL_DIR}/.env"; set +a
  ( yes 2>/dev/null || true ) | pnpm --filter @workspace/db run push 2>&1 | tail -20
  ok "Schema atualizado"

  step "Reiniciando serviço NetMon..."
  systemctl restart netmon
  sleep 2
  if systemctl is-active --quiet netmon; then
    ok "Serviço reiniciado com sucesso"
  else
    warn "Serviço com problema. Verifique: sudo journalctl -u netmon -n 50"
  fi

  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════════════╗"
  echo "  ║           ✅  BACKUP RESTAURADO COM SUCESSO!                    ║"
  echo "  ╠══════════════════════════════════════════════════════════════════╣"
  printf "  ║  %-66s║\n" ""
  printf "  ║  %-66s║\n" "  Faça login com o usuário/senha do backup restaurado —"
  printf "  ║  %-66s║\n" "  não o admin/admin123 padrão."
  printf "  ║  %-66s║\n" ""
  echo -e "  ╚══════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  press_enter_menu
}

# =============================================================================
#  HELPERS INTERNOS (SSL + Nginx + Firewall)
# =============================================================================
_gen_ssl() {
  step "Gerando certificado SSL autoassinado (10 anos)..."
  mkdir -p "${SSL_DIR}"
  chmod 700 "${SSL_DIR}"

  local HOSTNAME_LOCAL
  HOSTNAME_LOCAL="$(hostname)"

  local SAN_CONF
  SAN_CONF="$(mktemp)"
  cat > "${SAN_CONF}" <<SAN
[req]
distinguished_name = req_distinguished_name
x509_extensions    = v3_req
prompt             = no

[req_distinguished_name]
CN = NetMon
O  = NetMon
C  = BR

[v3_req]
subjectAltName = @alt_names
keyUsage       = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
IP.1  = ${SERVER_IP}
IP.2  = 127.0.0.1
DNS.1 = ${HOSTNAME_LOCAL}
DNS.2 = localhost
SAN

  openssl req -x509 \
    -newkey rsa:4096 \
    -keyout "${KEY_FILE}" \
    -out    "${CERT_FILE}" \
    -days   3650 \
    -nodes \
    -config "${SAN_CONF}" 2>/dev/null

  rm -f "${SAN_CONF}"
  chmod 600 "${KEY_FILE}"
  chmod 644 "${CERT_FILE}"
  ok "Certificado gerado: ${CERT_FILE}"
}

_config_nginx() {
  step "Configurando Nginx com HTTPS..."
  cat > /etc/nginx/sites-available/netmon <<NGINX
# NetMon — HTTPS

# Redirecionar HTTP → HTTPS
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 301 https://\$host\$request_uri;
}

# HTTPS principal
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    server_name _;
    client_max_body_size 10M;

    ssl_certificate     ${CERT_FILE};
    ssl_certificate_key ${KEY_FILE};

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options    nosniff always;
    add_header X-Frame-Options           SAMEORIGIN always;

    root ${INSTALL_DIR}/artifacts/netmon/dist/public;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Terminal IA — WebSocket bridge (SSH/Telnet). Must come before the generic
    # /api/ block so the Upgrade headers and long timeout apply to it — nginx
    # picks the longest matching prefix, so declaration order doesn't matter,
    # but keeping it here documents the relationship.
    location /api/terminal/ws {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   Cookie            \$http_cookie;
        proxy_pass_header  Set-Cookie;
        # Terminal sessions are long-lived and can sit idle — a short timeout
        # would silently drop the connection mid-session.
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   Cookie            \$http_cookie;
        proxy_pass_header  Set-Cookie;
        proxy_read_timeout 60s;
    }
}
NGINX

  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/netmon /etc/nginx/sites-enabled/netmon

  nginx -t 2>/dev/null || fail "Configuração do Nginx inválida."
  systemctl restart nginx
  systemctl enable nginx --quiet
  ok "Nginx configurado com HTTPS (443) e redirect 80 → 443"
}

_config_firewall() {
  step "Configurando firewall (ufw)..."
  if command -v ufw &>/dev/null; then
    ufw allow 22/tcp  comment 'SSH'          &>/dev/null || true
    ufw allow 80/tcp  comment 'NetMon HTTP'  &>/dev/null || true
    ufw allow 443/tcp comment 'NetMon HTTPS' &>/dev/null || true
    ufw --force enable &>/dev/null || true
    ok "Firewall configurado (portas 22, 80 e 443)"
  else
    warn "ufw não encontrado — verifique as regras de firewall manualmente"
  fi
}

# =============================================================================
#  ENTRY POINT
# =============================================================================
detect_ip
show_menu
