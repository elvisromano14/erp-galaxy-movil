import { Linking, StyleSheet, Text, View } from 'react-native';
import { env, updater } from '../core/services';
import { useUpdate } from '../features/update/hooks';
import { formatMb } from '../features/update/updatePolicy';
import { Banner, Button, colors, ErrorText, Muted } from './kit';

/**
 * Panel de actualización de la app: versión nueva, notas, descarga con progreso (reanudable), verificación e instalación.
 * `mandatory` = la versión instalada ya no sirve: no se puede aplazar. Los pendientes sin enviar se conservan siempre.
 */
export function UpdatePanel({ onLater }: { onLater?: () => void }) {
  const s = useUpdate((x) => x);
  const info = s.info;
  const mandatory = s.kind === 'mandatory';
  const pct = s.progress && s.progress.total > 0 ? Math.min(100, Math.floor((s.progress.received / s.progress.total) * 100)) : 0;
  const busy = s.phase === 'downloading' || s.phase === 'verifying' || s.phase === 'checking' || s.phase === 'installing';

  if (!info?.version || s.kind === 'none') {
    return (
      <View style={{ gap: 12 }}>
        <Muted>{s.phase === 'checking' ? 'Buscando actualizaciones…' : `Tiene la versión más reciente (${env.appVersion}).`}</Muted>
        {s.manualOnly && <Banner>Para buscar actualizaciones hay que iniciar sesión. También puede descargar la app desde Configuración → App móvil del ERP.</Banner>}
        <Button title="Buscar actualización" kind="secondary" disabled={busy} onPress={() => void updater.check({ force: true })} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={st.version}>Versión {info.version}{info.sizeBytes ? ` · ${formatMb(info.sizeBytes)}` : ''}</Text>
      <Muted>Instalada: {env.appVersion}</Muted>
      {mandatory && <Banner>Esta actualización es obligatoria para seguir usando la app. Sus operaciones pendientes se conservan.</Banner>}
      {info.notes ? <View style={st.notes}><Text style={{ color: colors.text }}>{info.notes}</Text></View> : null}

      {s.phase === 'downloading' && (
        <View style={{ gap: 6 }}>
          <View style={st.track}><View style={[st.fill, { width: `${pct}%` }]} /></View>
          <Muted>Descargando… {pct} %{s.progress ? ` (${formatMb(s.progress.received)} de ${formatMb(s.progress.total)})` : ''}</Muted>
          <Button title="Cancelar" kind="secondary" onPress={() => updater.cancelDownload()} />
        </View>
      )}
      {s.phase === 'verifying' && <Muted>Verificando la descarga (huella SHA-256)… {s.verifying !== null ? `${Math.floor(s.verifying * 100)} %` : ''}</Muted>}

      <ErrorText>{s.error}</ErrorText>
      {s.manualOnly && <Banner>Su sesión no permite descargar aquí. Descargue la app desde Configuración → App móvil del ERP.</Banner>}

      {(s.phase === 'available' || s.phase === 'error') && !s.manualOnly && (
        <Button title={s.resumable ? 'Continuar la descarga' : 'Descargar actualización'} onPress={() => void updater.download()} />
      )}
      {(s.phase === 'ready' || s.phase === 'installing') && (
        <>
          <Muted>Descarga verificada. Al instalar, Android pedirá su confirmación; la app se reiniciará con la versión nueva.</Muted>
          <Button title="Instalar ahora" disabled={s.phase === 'installing'} onPress={() => void updater.install()} />
          <Muted>Si Android indica que no se permite instalar desde esta app, active «Permitir de esta fuente» en el ajuste que se abre y vuelva a pulsar «Instalar ahora».</Muted>
          <Button title="Abrir ajustes de instalación" kind="secondary" onPress={() => void updater.openInstallSettings().catch(() => Linking.openSettings())} />
        </>
      )}
      {!mandatory && onLater && !busy && <Button title="Más tarde" kind="secondary" onPress={() => { updater.postpone(); onLater(); }} />}
    </View>
  );
}

const st = StyleSheet.create({
  version: { fontSize: 20, fontWeight: '700', color: colors.text },
  notes: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 10, backgroundColor: colors.primary },
});
