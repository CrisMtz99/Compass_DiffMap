#!/usr/bin/env bash
# Instala Compass en ~/.compass y deja el comando `compass` en ~/.local/bin.
# Uso: curl -fsSL https://raw.githubusercontent.com/CrisMtz99/Compass_DiffMap/main/scripts/install.sh | bash
#      COMPASS_REF=<rama|tag> para una versión concreta. COMPASS_SKILL=project para copiar la skill al repo actual.
set -euo pipefail

REPO="${COMPASS_REPO:-https://github.com/CrisMtz99/Compass_DiffMap.git}"
REF="${COMPASS_REF:-main}"
DIR="${COMPASS_HOME:-$HOME/.compass}"
BIN="${COMPASS_BIN:-$HOME/.local/bin}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "compass: falta $1" >&2; exit 1; }; }
need git
need node
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "compass: se requiere Node 20+ (tienes $(node -v))" >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "→ instalando pnpm con corepack"; corepack enable >/dev/null 2>&1 || npm i -g pnpm; }

if [ -d "$DIR/.git" ]; then
  echo "→ actualizando $DIR"
  git -C "$DIR" fetch -q origin "$REF" && git -C "$DIR" checkout -q FETCH_HEAD
else
  echo "→ clonando en $DIR"
  git clone -q --branch "$REF" "$REPO" "$DIR"
fi

cd "$DIR"
pnpm install --frozen-lockfile --silent || pnpm install --silent
pnpm build >/dev/null

mkdir -p "$BIN"
cat > "$BIN/compass" <<EOF
#!/usr/bin/env bash
exec node "$DIR/packages/cli/dist/index.js" "\$@"
EOF
chmod +x "$BIN/compass"

# Skill de Claude Code: personal (~/.claude/skills) o del proyecto actual (.claude/skills)
if [ "${COMPASS_SKILL:-user}" = "project" ]; then
  SKILL_DST="$(pwd -P)/.claude/skills/compass"
else
  SKILL_DST="$HOME/.claude/skills/compass"
fi
mkdir -p "$(dirname "$SKILL_DST")"
rm -rf "$SKILL_DST"
cp -R "$DIR/skill/compass" "$SKILL_DST"

echo "✓ compass instalado: $BIN/compass"
echo "✓ skill copiada a $SKILL_DST"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "  agrega $BIN a tu PATH (p. ej. en ~/.zshrc: export PATH=\"$BIN:\$PATH\")";; esac
