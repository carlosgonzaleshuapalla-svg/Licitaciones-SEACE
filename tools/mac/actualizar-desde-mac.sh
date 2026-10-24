#!/bin/zsh
# Recolecta las licitaciones vigentes de SEACE desde esta Mac y publica la
# semilla en la rama `data` del repo.
#
# Por qué desde la Mac: SEACE bloquea las IPs de los servidores (Render y los
# runners de GitHub), pero responde bien desde una conexión doméstica. El
# workflow de GitHub solo lee la semilla publicada y avisa en Notion.
#
# Corre con el mismo ritmo que el servidor (1 pedido cada 2 s) y guarda su base
# entre corridas, así que después de la primera solo baja lo nuevo. Si SEACE
# limita el acceso, no publica nada y lo deja anotado en el registro.

set -u
REPO_DIR="${0:A:h:h:h}"
DATOS="$HOME/Library/Application Support/licitaciones-seace"
REGISTRO="$HOME/Library/Logs/licitaciones-seace.log"
REMOTO="https://github.com/carlosgonzaleshuapalla-svg/Licitaciones-SEACE.git"
NODE="${NODE:-/usr/local/bin/node}"

mkdir -p "$DATOS" "$(dirname "$REGISTRO")"
exec >>"$REGISTRO" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') inicio ==="

# Una sola corrida a la vez (la primera tarda ~20 min).
if ! mkdir "$DATOS/lock" 2>/dev/null; then
  if [ -n "$(find "$DATOS/lock" -mmin +180 2>/dev/null)" ]; then
    rmdir "$DATOS/lock" && mkdir "$DATOS/lock"
  else
    echo "Ya hay una corrida en curso; se omite."
    exit 0
  fi
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; rmdir "$DATOS/lock" 2>/dev/null' EXIT

cd "$REPO_DIR/backend" || exit 1
[ -d node_modules ] || npm ci --silent || exit 1

# Hasta 150 resultados por corrida (a 1 pedido cada 2 s son ~5 min): alcanza para ponerse al día.
if ! SEACE_RESULTADOS_LIMITE=150 SEACE_DB_PATH="$DATOS/seace.db" "$NODE" scripts/recolectar.mjs "$TMP/semilla.json.gz"; then
  echo "SEACE no entregó datos frescos y completos; no se publica."
  exit 3
fi
# Historial de precios adjudicados (solo local, no se publica): copia legible en Excel.
SEACE_DB_PATH="$DATOS/seace.db" "$NODE" scripts/consultar-precios.mjs --csv "$DATOS/resultados-adjudicados.csv" || echo "No se pudo escribir el CSV de precios."

python3 -I "$REPO_DIR/.github/scripts/validar_semilla.py" "$TMP/semilla.json.gz" || { echo "Semilla inválida; no se publica."; exit 4; }

# Un solo commit sin historial, igual que antes.
mkdir "$TMP/publicar" && cp "$TMP/semilla.json.gz" "$TMP/publicar/seed.json.gz"
cd "$TMP/publicar" || exit 1
git init -q -b data
git add seed.json.gz
git -c user.name="Licitaciones SEACE (Mac)" -c user.email="noreply@users.noreply.github.com" \
  commit -q -m "Semilla de datos $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if GIT_TERMINAL_PROMPT=0 git push -f "$REMOTO" data; then
  echo "Semilla publicada en la rama data."
else
  echo "No se pudo publicar (¿faltan credenciales de GitHub en el llavero?)."
  exit 5
fi
