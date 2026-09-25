import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/app_state.dart';

class VehicleSelectScreen extends StatelessWidget {
  const VehicleSelectScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Select vehicle'),
        actions: [
          IconButton(
            tooltip: 'Log out',
            icon: const Icon(Icons.logout),
            onPressed: () => state.logout(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: state.loadVehicles,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Verified vehicles for ${state.user?.organizationId ?? ''}',
              style: theme.textTheme.bodySmall?.copyWith(color: Colors.white54),
            ),
            const SizedBox(height: 12),
            if (state.vehicles.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: Center(child: Text('No verified vehicles assigned.')),
              ),
            for (final v in state.vehicles)
              _VehicleCard(
                vehicle: v,
                selected: state.selectedVehicle?.id == v.id,
                onTap: () => state.selectVehicle(v),
              ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: state.selectedVehicle == null
                ? null
                : () => Navigator.of(context).pushReplacementNamed('/home'),
            child: const Text('Continue'),
          ),
        ),
      ),
    );
  }
}

class _VehicleCard extends StatelessWidget {
  const _VehicleCard({
    required this.vehicle,
    required this.selected,
    required this.onTap,
  });

  final Vehicle vehicle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final verified = vehicle.verificationStatus == 'verified';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(
          color: selected ? theme.colorScheme.error : Colors.white12,
          width: selected ? 2 : 1,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(
                vehicle.vehicleType == 'ambulance'
                    ? Icons.local_hospital
                    : vehicle.vehicleType == 'fire_truck'
                        ? Icons.fire_truck
                        : Icons.local_police,
                size: 36,
                color: theme.colorScheme.error,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      vehicle.id,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text('Type: ${vehicle.typeLabel}'),
                    Text('Organization: ${vehicle.organizationName ?? vehicle.organizationId}'),
                    if (vehicle.driverName != null) Text('Driver: ${vehicle.driverName}'),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Icon(
                          verified ? Icons.verified : Icons.warning_amber,
                          size: 14,
                          color: verified ? Colors.greenAccent : Colors.amber,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          verified ? 'Verified' : 'Not verified',
                          style: TextStyle(
                            color: verified ? Colors.greenAccent : Colors.amber,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Text(
                          vehicle.status == 'on_trip' ? 'On trip' : 'Idle',
                          style: const TextStyle(fontSize: 12, color: Colors.white54),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (selected)
                Icon(Icons.check_circle, color: theme.colorScheme.error),
            ],
          ),
        ),
      ),
    );
  }
}
