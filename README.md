```
  ███╗   ██╗███████╗████████╗███╗   ███╗ ██████╗ ███╗   ██╗
  ████╗  ██║██╔════╝╚══██╔══╝████╗ ████║██╔═══██╗████╗  ██║
  ██╔██╗ ██║█████╗     ██║   ██╔████╔██║██║   ██║██╔██╗ ██║
  ██║╚██╗██║██╔══╝     ██║   ██║╚██╔╝██║██║   ██║██║╚██╗██║
  ██║ ╚████║███████╗   ██║   ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║
  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
```

**Network HUB** para administradores de rede: monitoramento de hosts, dashboard MikroTik, monitoramento detalhado de Windows, terminal SSH com IA, backups automáticos — tudo self-hosted, na sua própria infraestrutura.

## O que o NetMon faz

- **Monitoramento de hosts** — ping ICMP em PCs, servidores e dispositivos, com histórico de status e alertas de host offline.
- **Dashboard MikroTik** — CPU, RAM, temperatura, tráfego de interfaces em tempo real, tabela de rotas, leases DHCP, regras de firewall, endereços IP e log do sistema de um roteador RouterOS.
- **NetMon Agent** — monitoramento detalhado de hosts Windows (CPU, RAM, uptime, versão do SO e processos rodando) via um agente compatível com windows_exporter.
- **Terminal SSH/Telnet com IA** — conecta em qualquer host cadastrado direto do navegador, com um assistente de IA (Claude, GPT, Gemini, DeepSeek ou Groq) que lê o terminal e propõe comandos — nunca executa nada sem sua aprovação.
- **Descoberta de hosts** — varre a rede local em busca de dispositivos ainda não cadastrados.

## Instalação / Atualização

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/raianwp/netmon-network-hub/main/install.sh)"
```

Esse comando baixa a última versão publicada e abre o instalador (`netmon.sh`), que reconhece sozinho se é uma instalação nova ou uma atualização.

Depois de instalado, acesse `http://<ip-do-servidor>` no navegador.

**Credenciais padrão:** `admin` / `admin123` — troque em Configurações → Controle de Acesso assim que entrar.

## O que cada opção do instalador faz

| Opção | O que faz |
|---|---|
| **1) Atualizar NetMon** | Aplica a versão mais recente, preservando banco de dados e configurações. |
| **2) Ativar / Renovar HTTPS** | Gera (ou renova) o certificado autoassinado usado pelo nginx. Toda renovação gera um par de chaves novo — é preciso reinstalar o certificado como confiável no navegador/cliente depois. |
| **3) Resetar senha admin** | Redefine o login `admin` para a senha padrão, caso o acesso tenha se perdido. |
| **4) Status do serviço** | Mostra logs e informações do serviço em tempo real. |
| **5) Reinstalar do zero** | Apaga banco de dados e configurações e reinstala — use só se quiser começar do zero. |
| **6) Restaurar Backup** | Substitui o banco atual pelo conteúdo de um arquivo `.sql` (veja abaixo). |
| **0) Sair** | Fecha o instalador sem fazer nada. |

Numa máquina sem instalação encontrada, a única opção é **1) Instalar NetMon**.

## Como restaurar um backup

O NetMon salva um backup automático a cada 24h (configurável em Configurações) em `/opt/netmon/backups/`, sempre mantendo só o mais recente.

Pra restaurar:

1. Copie o arquivo `.sql` que quer restaurar (o backup automático, ou qualquer dump seu) para uma pasta chamada `backups` **do lado do `netmon.sh`** que você está executando (ex: se rodou o comando de instalação, isso fica em `/tmp/netmon-network-hub/backups/`).
2. Rode o instalador e escolha **6) Restaurar Backup**.
3. Escolha o arquivo na lista e confirme digitando `sim`.

⚠️ Isso substitui **todo** o banco de dados atual (hosts, usuários, configurações) pelo conteúdo do backup escolhido. O arquivo `.env` (credenciais de conexão do banco) não é alterado.

## NetMon Agent (monitoramento detalhado de Windows)

Pra ver CPU, RAM, uptime, versão do Windows e processos rodando de um host Windows (além do ping básico), instale o NetMon Agent nele.

**Download:** [netmon-agent-1.0.msi](https://github.com/raianwp/netmon-network-hub/releases/download/agent-v1.0/netmon-agent-1.0.msi)

1. Rode o `.msi` no host Windows que você quer monitorar em detalhe.
2. Na tela de firewall, deixe marcado "Criar regra no Firewall do Windows" (recomendado, senão o NetMon pode não conseguir coletar os dados).
3. O instalador já registra o serviço `windows_exporter` configurado e rodando na porta `9182` — não precisa configurar nada a mais no Windows.
4. No NetMon, vá em Cadastro, edite (ou crie) o host correspondente e ative o toggle **"Monitoramento Detalhado (Agent)"**.

Depois disso, a tela de Monitoramento passa a mostrar um ícone extra nesse host pra abrir a janela de métricas detalhadas.

## Requisitos do servidor

- Ubuntu Server 20.04+ (ou Debian equivalente)
- Acesso root (via `sudo`)
- Conexão com a internet (pra baixar dependências na instalação/atualização)

O instalador cuida do resto — Node.js, PostgreSQL, Nginx e todas as dependências são instaladas automaticamente.

## Desenvolvedor

Raian William
