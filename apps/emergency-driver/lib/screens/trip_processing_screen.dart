import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/recents.dart';
import '../models/models.dart';
import '../state/app_state.dart';

/// Screen 7: request processing. Shows each stage as it happens, gates the
/// final hop on central-system approval (or the fallback timeout), and
/// explains any rejection instead of silently dropping the driver.
class TripProcessingScreen extends StatefulWidget {
  const TripProcessingScreen({super.key});

  @override
  State<TripProcessingScreen> createState() => _TripProcessingScreenState();
}

class _TripProcessingScreenState extends State<TripProcessingScreen> {
  static const _stages = [
    'Emergency request sent',
    'Vehicle and driver verified',
    'Checking traffic conditions',
    'Calculating best route',
    'Preparing junction recommendations',
    'Waiting for central approval',
  ];

  int _stage = 0;
  String? _error;
  bool _sending = true;
  bool _navigated = false;
  bool _approving = false;
  Timer? _timer;
  TripDraft? _draft;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _draft ??= ModalRoute.of(context)?.settings.arguments as TripDraft?;
    if (_draft != null && _sending) {
      _sending = false;
      _submit();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _submit() async {
    final state = context.read<AppState>();
    final draft = _draft;
    if (draft == null) return;
    setState(() {
      _error = null;
      _stage = 1;
    });

    final fix = await state.location.currentFix();
    final gps = state.location.gps;
    final dest = draft.destination;
    final originFix = GpsFix(
      latitude: fix?.latitude ?? gps.latitude ?? dest.latitude + 0.012,
      longitude: fix?.longitude ?? gps.longitude ?? dest.longitude + 0.011,
      accuracyM: fix?.accuracy ?? gps.accuracyM ?? 12.0,
      speedKmph: fix != null ? fix.speed * 3.6 : 0,
      heading: fix?.heading,
      batteryPercent: state.location.batteryPercent,
      networkStatus: state.location.online ? 'online' : 'offline',
      timestamp: DateTime.now(),
      vehicleId: state.selectedVehicle?.id,
      driverId: state.user?.userId,
    );

    final tripId = await state.startTrip(draft: draft, originFix: originFix);
    if (!mounted) return;

    if (tripId == null) {
      setState(() {
        _error = state.messages.isNotEmpty
            ? state.messages.last['text']
            : 'The control center did not accept the request.';
      });
      return;
    }

    await Recents.push(dest);
    if (!mounted) return;

    setState(() => _stage = 3);
    // Cosmetic pacing for the middle stages while the socket warms up;
    // the real gate is approval (or the 15s fallback below).
    _timer = Timer.periodic(const Duration(milliseconds: 700), (t) {
      if (!mounted || _stage >= _stages.length - 1) {
        t.cancel();
        return;
      }
      setState(() => _stage++);
    });

    // Fallback: if no approval arrives (or the socket is down), let the
    // driver through — the app polls snapshots regardless.
    Timer(const Duration(seconds: 15), () {
      if (mounted && !_navigated) _goActive();
    });
  }

  void _watchApproval(AppState state) {
    if (_navigated || _approving || _error != null) return;
    const approved = {'route_approved', 'corridor_preparing', 'corridor_active'};
    if (state.activeTripId != null && approved.contains(state.tripStatus)) {
      _approving = true;
      // This runs during build — defer the setState to the next frame.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_navigated) setState(() => _stage = _stages.length);
      });
      Timer(const Duration(milliseconds: 600), () {
        if (mounted) _goActive();
      });
    }
  }

  void _goActive() {
    if (_navigated || !mounted) return;
    _navigated = true;
    Navigator.of(context).pushReplacementNamed('/active-trip');
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);
    _watchApproval(state);

    if (_error != null) {
      return _RejectedPanel(
        error: _error!,
        onRetry: () => setState(() {
          _error = null;
          _stage = 1;
          _submit();
        }),
        onEdit: () => Navigator.of(context).pop(),
      );
    }

    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Requesting green corridor'),
          automaticallyImplyLeading: false,
        ),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              state.destinationName.isEmpty
                  ? 'Emergency trip'
                  : 'To ${state.destinationName}',
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              '${emergencyTypes[state.emergencyType] ?? state.emergencyType} · ${priorityLevels[state.priority] ?? state.priority}',
              style: theme.textTheme.bodySmall?.copyWith(color: Colors.white54),
            ),
            const SizedBox(height: 24),
            for (var i = 0; i < _stages.length; i++)
              _StageRow(
                label: _stages[i],
                state: i < _stage
                    ? _StageState.done
                    : i == _stage
                        ? _StageState.active
                        : _StageState.pending,
                isLast: i == _stages.length - 1,
              ),
            const SizedBox(height: 24),
            if (state.messages.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.04),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  state.messages.last['text'] ?? '',
                  style: const TextStyle(fontSize: 13, color: Colors.white70),
                ),
              ),
            const SizedBox(height: 16),
            Text(
              'Keep the app open. GPS streaming starts as soon as the route is approved.',
              style: theme.textTheme.bodySmall?.copyWith(color: Colors.white38),
            ),
          ],
        ),
      ),
    );
  }
}

enum _StageState { done, active, pending }

class _StageRow extends StatelessWidget {
  const _StageRow({
    required this.label,
    required this.state,
    required this.isLast,
  });

  final String label;
  final _StageState state;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = switch (state) {
      _StageState.done => Colors.greenAccent,
      _StageState.active => theme.colorScheme.error,
      _StageState.pending => Colors.white24,
    };

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Column(
            children: [
              SizedBox(
                height: 26,
                width: 26,
                child: switch (state) {
                  _StageState.done => const Icon(Icons.check_circle, size: 24, color: Colors.greenAccent),
                  _StageState.active => CircularProgressIndicator(strokeWidth: 2.4, color: theme.colorScheme.error),
                  _StageState.pending => Icon(Icons.radio_button_unchecked, size: 22, color: color),
                },
              ),
              if (!isLast)
                Expanded(
                  child: Container(width: 2, color: color.withValues(alpha: 0.35)),
                ),
            ],
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 22),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: state == _StageState.active ? FontWeight.w700 : FontWeight.w500,
                  color: state == _StageState.pending ? Colors.white38 : Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RejectedPanel extends StatelessWidget {
  const _RejectedPanel({
    required this.error,
    required this.onRetry,
    required this.onEdit,
  });

  final String error;
  final VoidCallback onRetry;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Request not accepted'),
        automaticallyImplyLeading: false,
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(Icons.error_outline, size: 52, color: theme.colorScheme.error),
            const SizedBox(height: 14),
            Text(
              'The route request was not accepted',
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.error.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(error, style: const TextStyle(fontSize: 14)),
            ),
            const SizedBox(height: 14),
            const Text(
              'Common causes: backend unreachable from this network, vehicle already on an active trip, '
              'or critical priority used with a non-qualifying emergency type. Correct the details and try again.',
              style: TextStyle(fontSize: 13, color: Colors.white54),
            ),
            const Spacer(),
            FilledButton(
              onPressed: onRetry,
              child: const Text('Retry request'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(onPressed: onEdit, child: const Text('Edit details')),
          ],
        ),
      ),
    );
  }
}
