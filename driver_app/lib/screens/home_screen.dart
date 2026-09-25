import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final state = context.read<AppState>();
      await state.location.ensurePermissions();
      if (state.activeTripId != null) {
        // App reopened mid-trip: get the driver back on the active screen.
        final resumed = await state.resumeTrip(state.activeTripId!);
        if (resumed && mounted) {
          Navigator.of(context).pushReplacementNamed('/active-trip');
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);
    final gps = state.location.gps;

    return Scaffold(
      appBar: AppBar(
        title: const Text('ResQConnect'),
        actions: [
          PopupMenuButton<String>(
            tooltip: 'Menu',
            icon: const Icon(Icons.more_vert),
            onSelected: (v) async {
              switch (v) {
                case 'vehicles':
                  Navigator.of(context).pushNamed('/vehicles');
                case 'logout':
                  await state.logout();
                  if (context.mounted) {
                    Navigator.of(context).pushNamedAndRemoveUntil('/login', (r) => false);
                  }
              }
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'vehicles', child: Text('Switch vehicle')),
              PopupMenuItem(
                value: 'logout',
                child: Text(
                  'Log out',
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            ],
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: state.loadVehicles,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            state.user?.name ?? 'Driver',
                            style: theme.textTheme.headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Chip(
                          avatar: Icon(
                            state.selectedVehicle?.status == 'on_trip'
                                ? Icons.local_activity
                                : Icons.check_circle_outline,
                            size: 15,
                            color: state.selectedVehicle?.status == 'on_trip'
                                ? Colors.amber
                                : Colors.greenAccent,
                          ),
                          label: Text(
                            state.selectedVehicle?.status == 'on_trip'
                                ? 'On trip'
                                : 'Ready',
                            style: const TextStyle(fontSize: 12),
                          ),
                          visualDensity: VisualDensity.compact,
                        ),
                      ],
                    ),
                    Text(
                      '${state.selectedVehicle?.vehicleNumber ?? 'No vehicle'} · '
                      '${state.selectedVehicle?.typeLabel ?? ''} · '
                      '${state.selectedVehicle?.organizationName ?? ''}',
                      style: theme.textTheme.bodySmall?.copyWith(color: Colors.white54),
                    ),
                    const Divider(height: 24),
                    _StatusRow(
                      icon: Icons.gps_fixed,
                      label: 'GPS',
                      value: !gps.serviceEnabled
                          ? 'Service off'
                          : gps.permission.name == 'denied' ||
                                  gps.permission.name == 'deniedForever'
                              ? 'Permission needed'
                              : gps.gpsLost
                                  ? 'Signal lost'
                                  : gps.accuracyM != null
                                      ? 'Active · ±${gps.accuracyM!.toStringAsFixed(0)} m'
                                      : 'Waiting for fix',
                      color: gps.serviceEnabled && !gps.gpsLost
                          ? Colors.greenAccent
                          : Colors.amber,
                    ),
                    _StatusRow(
                      icon: state.location.online ? Icons.wifi : Icons.wifi_off,
                      label: 'Network',
                      value: state.location.online
                          ? state.location.queuedCount > 0
                              ? 'Online · ${state.location.queuedCount} queued'
                              : 'Online'
                          : 'Offline · ${state.location.queuedCount} queued',
                      color: state.location.online ? Colors.greenAccent : Colors.amber,
                    ),
                    _StatusRow(
                      icon: Icons.battery_5_bar,
                      label: 'Battery',
                      value: '${state.location.batteryPercent}%',
                      color: state.location.batteryPercent <= 20
                          ? Colors.redAccent
                          : Colors.greenAccent,
                    ),
                    _StatusRow(
                      icon: Icons.emergency_outlined,
                      label: 'Control center',
                      value: state.wsConnected ? 'Connected' : 'Not connected',
                      color:
                          state.wsConnected ? Colors.greenAccent : Colors.redAccent,
                    ),
                    _StatusRow(
                      icon: Icons.directions_car,
                      label: 'Vehicle',
                      value: state.selectedVehicle?.status == 'on_trip'
                          ? 'On trip'
                          : 'Ready',
                      color: Colors.greenAccent,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 18),
                backgroundColor: theme.colorScheme.error,
              ),
              icon: const Icon(Icons.emergency),
              label: const Text(
                'START EMERGENCY TRIP',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              onPressed: () => Navigator.of(context).pushNamed('/start-trip'),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              icon: const Icon(Icons.add_alert_outlined),
              label: const Text('Report incident'),
              onPressed: () => Navigator.of(context).pushNamed('/incident'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16)),
                    icon: const Icon(Icons.history),
                    label: const Text('Trip history'),
                    onPressed: () => Navigator.of(context).pushNamed('/history'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16)),
                    icon: const Icon(Icons.support_agent),
                    label: const Text('Assistance'),
                    onPressed: () => Navigator.of(context).pushNamed('/assistance'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            if (state.messages.isNotEmpty) ...[
              Text('Control center feed', style: theme.textTheme.titleSmall),
              const SizedBox(height: 8),
              ...state.messages.reversed.take(5).map(
                    (m) => Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.04),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: m['kind'] == 'error'
                              ? Colors.redAccent.withValues(alpha: 0.4)
                              : m['kind'] == 'warn'
                                  ? Colors.amber.withValues(alpha: 0.3)
                                  : Colors.white12,
                        ),
                      ),
                      child: Text(m['text']!, style: const TextStyle(fontSize: 13)),
                    ),
                  ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          SizedBox(width: 110, child: Text(label, style: const TextStyle(fontSize: 14))),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontSize: 14, color: color, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
