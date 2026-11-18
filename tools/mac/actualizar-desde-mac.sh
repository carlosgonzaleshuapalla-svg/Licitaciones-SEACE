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

RAW="https://raw.githubusercontent.com/carlosgonzaleshuapalla-svg/Licitaciones-SEACE/data"

# Otras entidades del Estado con compras de hasta 8 UIT en su propio portal (SUNARP, SBN, SANIPES,
# MINSA, Hospital de Ventanilla). Es independiente de SEACE: se lee primero y se publica aunque
# SEACE no responda. Si una entidad cae, se conserva lo último publicado de ella.
curl -fsSL --max-time 60 "$RAW/entidades.json.gz" -o "$TMP/entidades-previo.json.gz" 2>/dev/null || rm -f "$TMP/entidades-previo.json.gz"
if "$NODE" scripts/recolectar-entidades.mjs "$TMP/entidades.json.gz" "$TMP/entidades-previo.json.gz"; then
  :
else
  echo "Entidades: no se pudo leer ningún portal; se publica sin actualizarlas."
  rm -f "$TMP/entidades.json.gz"
  [ -f "$TMP/entidades-previo.json.gz" ] && cp "$TMP/entidades-previo.json.gz" "$TMP/entidades.json.gz"
fi

# Publica en la rama `data` un solo commit sin historial: la semilla de SEACE y, si hay, el archivo de entidades.
publicar() {
  local semilla="$1" PUB
  PUB="$TMP/publicar"; rm -rf "$PUB"; mkdir "$PUB" && cp "$semilla" "$PUB/seed.json.gz"
  [ -f "$TMP/entidades.json.gz" ] && cp "$TMP/entidades.json.gz" "$PUB/entidades.json.gz"
  ( cd "$PUB" || exit 1
    git init -q -b data
    git add .
    git -c user.name="Licitaciones SEACE (Mac)" -c user.email="noreply@users.noreply.github.com" \
      commit -q -m "Semilla de datos $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    GIT_TERMINAL_PROMPT=0 git push -f "$REMOTO" data )
}

# Si SEACE no entregó datos frescos pero las entidades sí se leyeron, se vuelve a publicar la
# semilla anterior (ya validada cuando se subió) junto con las entidades nuevas: la rama `data` se
# recrea en cada publicación y, sin esto, perdería la semilla.
publicar_solo_entidades() {
  [ -f "$TMP/entidades.json.gz" ] || return 1
  curl -fsSL --max-time 120 "$RAW/seed.json.gz" -o "$TMP/semilla-previa.json.gz" || return 1
  python3 -I "$REPO_DIR/.github/scripts/validar_semilla.py" "$TMP/semilla-previa.json.gz" || return 1
  publicar "$TMP/semilla-previa.json.gz" && echo "Entidades publicadas (la semilla de SEACE se dejó como estaba)."
}

# Hasta 150 resultados por corrida (a 1 pedido cada 2 s son ~5 min): alcanza para ponerse al día.
if ! SEACE_RESULTADOS_LIMITE=150 SEACE_DB_PATH="$DATOS/seace.db" "$NODE" scripts/recolectar.mjs "$TMP/semilla.json.gz"; then
  echo "SEACE no entregó datos frescos y completos; no se publica la semilla de SEACE."
  publicar_solo_entidades
  exit 3
fi
# Historial de precios adjudicados (solo local, no se publica): copia legible en Excel.
SEACE_DB_PATH="$DATOS/seace.db" "$NODE" scripts/consultar-precios.mjs --csv "$DATOS/resultados-adjudicados.csv" || echo "No se pudo escribir el CSV de precios."
# Histórico con rubro y estadísticos (Bienes y Servicios) para el Excel y el modelo de precio (solo local, no se publica).
SEACE_DB_PATH="$DATOS/seace.db" "$NODE" scripts/exportar-historico.mjs --salida "$DATOS/historico" || echo "No se pudo exportar el histórico por rubro."

python3 -I "$REPO_DIR/.github/scripts/validar_semilla.py" "$TMP/semilla.json.gz" || { echo "Semilla inválida; no se publica."; publicar_solo_entidades; exit 4; }

if publicar "$TMP/semilla.json.gz"; then
  echo "Semilla publicada en la rama data."
else
  echo "No se pudo publicar (¿faltan credenciales de GitHub en el llavero?)."
  exit 5
fi
