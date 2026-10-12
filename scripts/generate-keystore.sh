#!/usr/bin/env bash
# Genera el keystore de firma de la app (una sola vez) y muestra los secretos que hay que cargar en GitHub.
#   scripts/generate-keystore.sh [alias]     (por omisión: erpventas)
# GUARDE el archivo y las contraseñas en un gestor de contraseñas Y en un respaldo fuera de línea. No lo suba al repositorio.
set -euo pipefail
ALIAS="${1:-erpventas}"
OUT="${KEYSTORE_OUT:-$HOME/erp-ventas-release.keystore}"
[ ! -e "$OUT" ] || { echo "Ya existe $OUT: no se sobrescribe."; exit 1; }
PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
if command -v keytool >/dev/null 2>&1; then
  keytool -genkeypair -v -storetype PKCS12 -keystore "$OUT" -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=ERP Ventas, O=Mini ERP, C=VE" >/dev/null 2>&1
else
  # Sin JDK instalado: se crea el mismo almacén PKCS12 con openssl (Gradle/Android lo aceptan igual).
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  openssl req -x509 -newkey rsa:2048 -sha256 -days 10000 -nodes -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -subj "/CN=ERP Ventas/O=Mini ERP/C=VE" 2>/dev/null
  openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$ALIAS" -out "$OUT" -passout "pass:$PASS" 2>/dev/null
fi
chmod 600 "$OUT"
cat <<MSG

Keystore creado: $OUT
  alias:       $ALIAS
  contraseña:  $PASS        (la misma para el almacén y la clave)

Secretos para GitHub (Settings → Secrets and variables → Actions):
  ANDROID_KEYSTORE_BASE64   = $(base64 -w0 "$OUT" | cut -c1-24)…   (comando: base64 -w0 $OUT)
  ANDROID_KEYSTORE_PASSWORD = $PASS
  ANDROID_KEY_ALIAS         = $ALIAS
  ANDROID_KEY_PASSWORD      = $PASS

O cárguelos con la CLI (desde este repositorio):
  base64 -w0 "$OUT" | gh secret set ANDROID_KEYSTORE_BASE64
  gh secret set ANDROID_KEYSTORE_PASSWORD --body '$PASS'
  gh secret set ANDROID_KEY_ALIAS --body '$ALIAS'
  gh secret set ANDROID_KEY_PASSWORD --body '$PASS'

IMPORTANTE: haga ahora un respaldo de $OUT y de la contraseña fuera de este equipo.
MSG
