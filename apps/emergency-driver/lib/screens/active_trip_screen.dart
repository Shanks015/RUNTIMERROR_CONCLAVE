import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/app_state.dart';

class ActiveTripScreen extends StatelessWidget {
  const ActiveTripScreen({super.key});

  static const _compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  String _direction(double? heading) {
    if (heading == null || !heading.isFinite) return '--';
    final h = heading % 360;
    final dir = _compass[((h / 45) + 0.5).floor() % 8];
    return '$dir ${h.toStringAsFixed(0)}°';
  }

  /// Current segment of the planned route (mock split into 10 legs —
  /// derived from the closest polyline vertex).
  String _segment(AppState state, int routeLength) {
    if (routeLength == 0) return '--';
    if (!state.hasFix) return '--';
    final pts = state.routeGeometry;
    if (pts.isEmpty) return '--';
    var best = 0;
    var bestDist = double.infinity;
    for (var i = 0; i < pts.length; i++) {
      final dLat = pts[i][0] - state.latitude;
      final dLon = pts[i][1] - state.longitude;
      final d = dLat * dLat + dLon * dLon;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    const total = 10;
    final seg = (best * total) ~/ routeLength + 1;
    return '$seg of $total';
  }

  String _signalLabel(String status) => switch (status) {
        'scheduled' => 'Scheduled',
        'preparing' => 'Preparing',
        'prepared' => 'Prepared',
        'green' => 'Green active',
        'monitoring' => 'Monitoring',
        'expired' => 'Expired',
        _ => status,
      };

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);
    final gps = state.location.gps;
    final notice = state.pendingRouteUpdate;

    final origin = LatLng(
      gps.latitude ?? 12.9852,
      gps.longitude ?? 77.6051,
    );
    final route = state.routeGeometry
        .map((p) => LatLng(p[0], p[1]))
        .toList(growable: false);
    final tripSnap = state.tripSnapshot;
    final destPoint = route.isNotEmpty
        ? route.last
        : LatLng(
            tripSnap?.destination.latitude ?? origin.latitude,
            tripSnap?.destination.longitude ?? origin.longitude,
          );

    final lastMessage = state.messages.isNotEmpty
        ? state.messages.last['text']!
        : 'Standing by for control-center updates.';

    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: Text(state.destinationName.isEmpty ? 'Active trip' : state.destinationName),
          automaticallyImplyLeading: false,
          actions: [
            Center(
              child: Padding(
                padding: const EdgeInsets.only(right: 14),
                child: Chip(
                  avatar: Icon(
                    state.controlCenterOnline ? Icons.cloud_done : Icons.cloud_off,
                    size: 16,
                    color: state.controlCenterOnline
                        ? Colors.greenAccent
                        : Colors.redAccent,
                  ),
                  label: Text(
                    state.controlCenterOnline ? 'Live' : 'Offline',
                    style: const TextStyle(fontSize: 12),
                  ),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ),
          ],
        ),
        body: Column(
          children: [
            // ---- status banner ----
            Container(
              width: double.infinity,
              color: theme.colorScheme.error.withValues(alpha: 0.16),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      SizedBox(
                        height: 10,
                        width: 10,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: theme.colorScheme.error,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        state.statusLabel,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const Spacer(),
                      Text(
                        'v${state.routeVersion}',
                        style: const TextStyle(color: Colors.white54, fontSize: 12),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    lastMessage,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, color: Colors.white70),
                  ),
                ],
              ),
            ),

            // ---- control-center cancellation: unmissable, above everything ----
            if (state.corridorCancellation != null)
              _CorridorCancelledBanner(
                reason: state.corridorCancellation!,
                onAcknowledge: () async {
                  final navigator = Navigator.of(context);
                  await state.acknowledgeCancellation();
                  navigator.pushNamedAndRemoveUntil('/home', (route) => false);
                },
              ),

            // ---- route update banner (screen 10) ----
            if (notice != null)
              _RouteUpdateBanner(notice: notice, state: state),

            // ---- map ----
            Expanded(
              child: FlutterMap(
                options: MapOptions(
                  initialCenter: origin,
                  initialZoom: 14,
                ),
                children: [
                  TileLayer(
                    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'in.conclave.resqconnect',
                  ),
                  if (route.isNotEmpty)
                    PolylineLayer(
                      polylines: [
                        Polyline(
                          points: route,
                          strokeWidth: 6,
                          color: theme.colorScheme.error,
                        ),
                      ],
                    ),
                  MarkerLayer(
                    markers: [
                      Marker(
                        point: origin,
                        width: 42,
                        height: 42,
                        child: gps.gpsLost
                            ? const Icon(Icons.location_searching,
                                color: Colors.amber, size: 36)
                            : const Icon(Icons.local_hospital,
                                color: Colors.blueAccent, size: 36),
                      ),
                      Marker(
                        point: destPoint,
                        width: 40,
                        height: 40,
                        child: const Icon(Icons.flag, color: Colors.redAccent, size: 36),
                      ),
                      for (final (i, _) in state.junctions.take(6).indexed)
                        if (i * 6 < route.length)
                          Marker(
                            point: route[(i + 1) * 6 < route.length ? (i + 1) * 6 : route.length - 1],
                            width: 26,
                            height: 26,
                            child: Icon(Icons.change_history,
                                size: 20, color: Colors.amberAccent),
                          ),
                    ],
                  ),
                ],
              ),
            ),

            // ---- trip panel ----
            Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
              decoration: BoxDecoration(
                color: theme.colorScheme.surface,
                border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.08))),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      _Metric(
                        label: 'ETA',
                        value: state.formatEta(state.etaSeconds),
                        highlight: true,
                      ),
                      _Metric(
                        label: 'Remaining',
                        value: state.distanceRemainingM != null
                            ? '${(state.distanceRemainingM! / 1000).toStringAsFixed(1)} km'
                            : '--',
                      ),
                      _Metric(
                        label: 'Speed',
                        value: gps.speedKmph != null
                            ? '${gps.speedKmph!.toStringAsFixed(0)} km/h'
                            : '--',
                      ),
                      _Metric(
                        label: 'GPS',
                        value: gps.accuracyM != null
                            ? '±${gps.accuracyM!.toStringAsFixed(0)} m'
                            : '--',
                        warn: gps.gpsLost || (gps.accuracyM ?? 0) > 50,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _Metric(
                        label: 'Direction',
                        value: _direction(gps.heading),
                      ),
                      _Metric(
                        label: 'Segment',
                        value: _segment(state, route.isEmpty ? 1 : route.length),
                      ),
                      _Metric(
                        label: 'Confidence',
                        value: state.location.lastConfidence > 0
                            ? state.location.lastConfidence.toStringAsFixed(2)
                            : '--',
                      ),
                      _Metric(
                        label: 'Junctions',
                        value: '${state.junctions.length}',
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.alt_route),
                          label: const Text('Re-route'),
                          onPressed: () => _rerouteSheet(context, state),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.traffic),
                          label: const Text('Junctions'),
                          onPressed: () => _junctionSheet(context, state, _signalLabel),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.add_alert_outlined),
                          label: const Text('Incident'),
                          onPressed: () => Navigator.of(context).pushNamed('/incident'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.support_agent),
                          label: const Text('Assistance'),
                          onPressed: () => Navigator.of(context).pushNamed('/assistance'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(
                            backgroundColor: theme.colorScheme.error,
                          ),
                          icon: const Icon(Icons.stop_circle_outlined),
                          label: const Text('End trip'),
                          onPressed: () => _endSheet(context, state),
                        ),
                      ),
                    ],
                  ),
                  if (state.location.queuedCount > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        '${state.location.queuedCount} locations queued offline',
                        style: const TextStyle(fontSize: 11, color: Colors.amber),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---- screen 9: junction signal panel ----
  void _junctionSheet(BuildContext context, AppState state, String Function(String) label) {
    showModalBottomSheet(
      context: context,
      builder: (sheetCtx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: state.junctions.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(24),
                  child: Text('No priority junctions on the current route.'),
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Priority junction panel',
                      style: Theme.of(sheetCtx)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Corridor v${state.routeVersion} · ${state.junctions.length} junctions',
                      style: const TextStyle(fontSize: 12, color: Colors.white54),
                    ),
                    const SizedBox(height: 10),
                    const Row(
                      children: [
                        Expanded(flex: 3, child: Text('Junction', style: _th)),
                        Expanded(flex: 3, child: Text('Arrival', style: _th)),
                        Expanded(flex: 4, child: Text('Signal status', style: _th)),
                      ],
                    ),
                    const Divider(height: 14),
                    for (final j in state.junctions)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 7),
                        child: Row(
                          children: [
                            Expanded(
                                flex: 3,
                                child: Text(j.junctionId,
                                    style: const TextStyle(
                                        fontSize: 14, fontWeight: FontWeight.w600))),
                            Expanded(
                                flex: 3,
                                child: Text('${j.arrivalInSeconds}s',
                                    style: const TextStyle(fontSize: 14))),
                            Expanded(
                              flex: 4,
                              child: Text(
                                label(j.signalStatus),
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: switch (j.signalStatus) {
                                    'green' => Colors.greenAccent,
                                    'prepared' => Colors.lightGreenAccent,
                                    'preparing' || 'monitoring' => Colors.amber,
                                    'expired' => Colors.redAccent,
                                    _ => Colors.white70,
                                  },
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(sheetCtx),
                        child: const Text('Close'),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  // ---- driver-initiated reroute ----
  void _rerouteSheet(BuildContext context, AppState state) {
    const reasons = [
      'Congestion detected ahead',
      'Accident blocking the route',
      'Road closed or blocked',
      'Wrong route selected',
      'Other — tell control center',
    ];
    showModalBottomSheet(
      context: context,
      builder: (sheetCtx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: Text(
                'Request a new route',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                'The control center will recompute the corridor and update your ETA.',
                style: TextStyle(fontSize: 13, color: Colors.white54),
              ),
            ),
            const SizedBox(height: 6),
            for (final r in reasons)
              ListTile(
                dense: true,
                leading: const Icon(Icons.alt_route, size: 18),
                title: Text(r, style: const TextStyle(fontSize: 14)),
                onTap: () async {
                  Navigator.pop(sheetCtx);
                  await state.reroute(reason: r);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Reroute requested: $r')),
                    );
                  }
                },
              ),
            const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }

  // ---- screen 13: end trip reasons + confirmation ----
  void _endSheet(BuildContext context, AppState state) {
    showModalBottomSheet(
      context: context,
      builder: (sheetCtx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: Text(
                'Why are you ending this trip?',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
            for (final e in endTripReasons.entries)
              ListTile(
                dense: true,
                leading: Icon(
                  switch (e.key) {
                    'completed' => Icons.check_circle_outline,
                    'cancelled' => Icons.cancel_outlined,
                    'diverted' => Icons.alt_route,
                    'patient_transferred' => Icons.local_hospital_outlined,
                    'vehicle_issue' => Icons.build_outlined,
                    _ => Icons.notes_outlined,
                  },
                  size: 19,
                ),
                title: Text(e.value, style: const TextStyle(fontSize: 14)),
                onTap: () {
                  Navigator.pop(sheetCtx);
                  _confirmEnd(context, state, e.key, e.value);
                },
              ),
            const SizedBox(height: 6),
            TextButton(
              onPressed: () => Navigator.pop(sheetCtx),
              child: const Text('Keep trip running', style: TextStyle(color: Colors.white54)),
            ),
            const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }

  void _confirmEnd(BuildContext context, AppState state, String key, String label) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('End trip — $label?'),
        content: const Text(
          'Are you sure you want to end this emergency trip? '
          'Location tracking will stop after confirmation.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Continue trip'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () async {
              Navigator.pop(ctx);
              final summary = await state.endTrip(key);
              if (summary != null && context.mounted) {
                Navigator.of(context)
                    .pushReplacementNamed('/trip-complete', arguments: summary);
              } else if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      state.messages.isNotEmpty
                          ? state.messages.last['text']!
                          : 'Could not end the trip.',
                    ),
                  ),
                );
              }
            },
            child: const Text('End trip'),
          ),
        ],
      ),
    );
  }
}

const _th = TextStyle(fontSize: 12, color: Colors.white54, fontWeight: FontWeight.w600);

/// Control-center cancellation. The corridor is already gone server-side, so
/// this blocks the screen until the driver acknowledges — the route under it
/// must never be read as still having junction priority.
class _CorridorCancelledBanner extends StatelessWidget {
  const _CorridorCancelledBanner({
    required this.reason,
    required this.onAcknowledge,
  });

  final String reason;
  final Future<void> Function() onAcknowledge;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      color: theme.colorScheme.error,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.gpp_bad, color: Colors.white),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Route cancelled by control center',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            reason,
            style: const TextStyle(color: Colors.white, fontSize: 14),
          ),
          const SizedBox(height: 2),
          const Text(
            'Junction priority has been released. Drive normally and end the trip.',
            style: TextStyle(color: Colors.white70, fontSize: 13),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: theme.colorScheme.error,
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: () => onAcknowledge(),
              child: const Text(
                'Acknowledge and end trip',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Screen 10: route-update banner with Accept / Reason / Contact actions.
class _RouteUpdateBanner extends StatelessWidget {
  const _RouteUpdateBanner({required this.notice, required this.state});

  final RouteUpdateNotice notice;
  final AppState state;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.amber.withValues(alpha: 0.14),
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.swap_horiz, size: 18, color: Colors.amber),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Route updated by control center',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ),
              Text(
                notice.oldEtaSeconds != null && notice.newEtaSeconds != null
                    ? '${state.formatEta(notice.oldEtaSeconds)} → ${state.formatEta(notice.newEtaSeconds)}'
                    : 'v${notice.routeVersion}',
                style: const TextStyle(fontSize: 12, color: Colors.amber),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            notice.reason,
            style: const TextStyle(fontSize: 13, color: Colors.white70),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              FilledButton(
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  backgroundColor: Colors.amber,
                  foregroundColor: Colors.black,
                ),
                onPressed: () {
                  state.acknowledgeRouteUpdate();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('New route accepted.')),
                  );
                },
                child: const Text('Accept new route'),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                style: OutlinedButton.styleFrom(visualDensity: VisualDensity.compact),
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Reason for change'),
                    content: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(notice.message),
                        const SizedBox(height: 12),
                        Text('Reason: ${notice.reason}',
                            style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text('New route version: v${notice.routeVersion}'),
                        if (notice.oldEtaSeconds != null)
                          Text('Previous ETA: ${state.formatEta(notice.oldEtaSeconds)}'),
                        if (notice.newEtaSeconds != null)
                          Text('Updated ETA: ${state.formatEta(notice.newEtaSeconds)}'),
                      ],
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx),
                        child: const Text('Close'),
                      ),
                    ],
                  ),
                ),
                child: const Text('View reason'),
              ),
              const SizedBox(width: 8),
              TextButton(
                style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                onPressed: () => Navigator.of(context).pushNamed('/assistance'),
                child: const Text('Contact center', style: TextStyle(fontSize: 13)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    this.highlight = false,
    this.warn = false,
  });

  final String label;
  final String value;
  final bool highlight;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final color = warn
        ? Colors.amber
        : highlight
            ? Theme.of(context).colorScheme.error
            : Colors.white;
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 11, color: Colors.white54)),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              style: TextStyle(
                fontSize: highlight ? 18 : 15,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
