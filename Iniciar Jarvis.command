#!/bin/bash
# Iniciar Jarvis (macOS): doble clic y listo.
#
# La primera vez: descarga Node.js y Claude Code dentro de ~/.jarvis-tools (sin contraseña de
# administrador, sin tocar nada más del Mac), te pide entrar con tu cuenta de Claude y abre
# Jarvis en el navegador. Las siguientes veces solo arranca y abre Jarvis.
#
# Nunca usa una API key: Jarvis piensa con tu suscripción de Claude.

set -u
cd "$(dirname "$0")" || exit 1
JARVIS_DIR="$(pwd)"
TOOLS="$HOME/.jarvis-tools"
NODE_VERSION="22.22.0"
NODE_DIR="$TOOLS/node"
PORT=4700
URL="http://127.0.0.1:$PORT"
unset ANTHROPIC_API_KEY          # siempre la suscripción, nunca una clave

say_step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
fail() {
  printf '\n\033[1;31m✗ %s\033[0m\n\n' "$1"
  read -r -p "Pulsa Intro para cerrar esta ventana..." _
  exit 1
}

clear
printf '\033[1m  J A R V I S\033[0m\n'
printf '  (no cierres esta ventana mientras uses Jarvis)\n'

# ── 1. Node.js (versión 22 o más nueva) ──────────────────────────────
node_ok() {
  local v
  v="$("$1" -v 2>/dev/null)" || return 1
  v="${v#v}"; [ "${v%%.*}" -ge 22 ] 2>/dev/null
}
export PATH="$NODE_DIR/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE=""
for candidate in "$NODE_DIR/bin/node" "$(command -v node 2>/dev/null)"; do
  if [ -n "$candidate" ] && node_ok "$candidate"; then NODE="$candidate"; break; fi
done
if [ -z "$NODE" ]; then
  say_step "Descargando Node.js $NODE_VERSION (solo la primera vez)..."
  case "$(uname -m)" in
    arm64)  ARCH="arm64"; SUM="5ed4db0fcf1eaf84d91ad12462631d73bf4576c1377e192d222e48026a902640" ;;
    x86_64) ARCH="x64";   SUM="5ea50c9d6dea3dfa3abb66b2656f7a4e1c8cef23432b558d45fb538c7b5dedce" ;;
    *) fail "No reconozco este Mac ($(uname -m))." ;;
  esac
  FILE="node-v$NODE_VERSION-darwin-$ARCH.tar.gz"
  mkdir -p "$TOOLS"
  curl -fL --progress-bar "https://nodejs.org/dist/v$NODE_VERSION/$FILE" -o "$TOOLS/$FILE" \
    || fail "No pude descargar Node.js. ¿Hay conexión a internet?"
  echo "$SUM  $TOOLS/$FILE" | shasum -a 256 -c - >/dev/null 2>&1 \
    || { rm -f "$TOOLS/$FILE"; fail "La descarga de Node.js no es la oficial (la firma no coincide). No la uso."; }
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xzf "$TOOLS/$FILE" -C "$NODE_DIR" --strip-components 1 || fail "No pude descomprimir Node.js."
  rm -f "$TOOLS/$FILE"
  NODE="$NODE_DIR/bin/node"
  printf '  Node.js listo.\n'
fi

# ── 2. Claude Code ───────────────────────────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  say_step "Instalando Claude Code (solo la primera vez)..."
  [ -x "$NODE_DIR/bin/node" ] || {
    # Node ya estaba en el Mac: instalamos Claude Code en nuestra carpeta igualmente.
    mkdir -p "$NODE_DIR/bin"; ln -sf "$NODE" "$NODE_DIR/bin/node"; }
  NPM="$(dirname "$NODE")/npm"
  "$NPM" install -g --prefix "$NODE_DIR" @anthropic-ai/claude-code >/dev/null 2>&1 \
    || fail "No pude instalar Claude Code. ¿Hay conexión a internet?"
  hash -r
  command -v claude >/dev/null 2>&1 || fail "Claude Code se instaló pero no lo encuentro."
  printf '  Claude Code listo.\n'
fi

# ── 3. Tu cuenta de Claude ───────────────────────────────────────────
if ! claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
  say_step "Entra con tu cuenta de Claude (solo la primera vez)"
  printf '  Se abrirá el navegador. Inicia sesión con tu cuenta de Claude\n'
  printf '  (la de tu suscripción) y vuelve a esta ventana.\n\n'
  claude auth login --claudeai
  claude auth status 2>/dev/null | grep -q '"loggedIn": *true' \
    || fail "No se completó el inicio de sesión. Haz doble clic en «Iniciar Jarvis» para intentarlo otra vez."
  printf '  Sesión iniciada.\n'
fi

# ── 4. Arrancar Jarvis y abrirlo ─────────────────────────────────────
if curl -s -o /dev/null "$URL/api/boot"; then
  say_step "Jarvis ya estaba en marcha. Abriendo $URL"
  open "$URL"
  exit 0
fi
[ -f "$JARVIS_DIR/viewer/graph-data.js" ] || "$NODE" "$JARVIS_DIR/build.mjs" >/dev/null || fail "No pude leer tus notas."

say_step "Arrancando Jarvis..."
"$NODE" "$JARVIS_DIR/server.mjs" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
for _ in $(seq 1 40); do
  curl -s -o /dev/null "$URL/api/boot" && break
  kill -0 $SERVER 2>/dev/null || fail "Jarvis no pudo arrancar (mira el mensaje de arriba)."
  sleep 0.25
done
open "$URL"
printf '\n\033[1;32m✓ Jarvis está abierto en tu navegador: %s\033[0m\n' "$URL"
printf '  Para apagarlo, cierra esta ventana.\n\n'
wait $SERVER
