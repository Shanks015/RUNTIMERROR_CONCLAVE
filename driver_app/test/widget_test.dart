import 'package:flutter_test/flutter_test.dart';

import 'package:emergency_driver_app/models/models.dart';
import 'package:emergency_driver_app/state/app_state.dart';

/// Frames the central operator console actually sends over
/// /ws/emergency-trips/{id}. A cancellation must never leave the driver
/// believing a junction still has priority.
void main() {
  test('route_cancelled clears the junction plan and flags the corridor', () {
    final state = AppState();
    state.handleSocketMessage({
      'type': 'snapshot',
      'status': 'corridor_active',
      'priority_junctions': [
        {'junction_id': 'J-12', 'arrival_in_seconds': 40, 'signal_status': 'active'},
        {'junction_id': 'J-14', 'arrival_in_seconds': 90, 'signal_status': 'preparing'},
      ],
    });
    expect(state.junctions, hasLength(2));
    expect(state.tripStatus, 'corridor_active');

    state.handleSocketMessage({
      'type': 'route_cancelled',
      'trip_id': 'TRIP-1',
      'status': 'cancelled',
      'reason': 'Patient moved to another unit',
      'message': 'Route cancelled by control center.',
    });

    expect(state.junctions, isEmpty, reason: 'stale priority must not survive');
    expect(state.tripStatus, 'cancelled');
    expect(state.corridorCancellation, 'Patient moved to another unit');
    expect(state.messages.last['text'], contains('Route cancelled'));
  });

  test('route_cancelled defaults the reason when the console omits one', () {
    final state = AppState();
    state.handleSocketMessage({'type': 'route_cancelled'});
    expect(state.corridorCancellation, isNotNull);
    expect(state.tripStatus, 'cancelled');
    expect(state.junctions, isEmpty);
  });

  test('operator_message lands in the feed', () {
    final state = AppState();
    state.handleSocketMessage({
      'type': 'operator_message',
      'urgency': 'urgent',
      'message': 'Ambulance bay 3 is clear.',
    });
    expect(state.messages.last['text'], 'Ambulance bay 3 is clear.');
  });

  test('a route_update still holds for acknowledgement', () {
    final state = AppState();
    state.handleSocketMessage({
      'type': 'route_update',
      'route_version': 4,
      'eta_seconds': 522,
      'old_eta_seconds': 640,
      'reason': 'Congestion detected on original route',
      'priority_junctions': [
        {'junction_id': 'J-12', 'arrival_in_seconds': 52, 'signal_status': 'preparing'},
      ],
    });
    final notice = state.pendingRouteUpdate;
    expect(notice, isNotNull);
    expect(notice!.reason, 'Congestion detected on original route');
    expect(notice.oldEtaSeconds, 640);
    expect(notice.newEtaSeconds, 522);
    expect(state.routeVersion, 4);
    expect(state.junctions.single.signalStatus, 'preparing');
  });

  test('a cancelled snapshot from polling flags the corridor too', () {
    // The socket can be down; polling is the fallback and must catch this.
    final state = AppState();
    state.applySnapshot(TripSnapshot.fromJson({
      'trip_id': 'TRIP-1',
      'status': 'corridor_active',
      'route_version': 2,
      'destination': {'name': 'City Hospital', 'latitude': 12.935, 'longitude': 77.6245},
      'signal_plan': [
        {'junction_id': 'J-12', 'arrival_in_seconds': 40, 'signal_status': 'active'},
      ],
    }));
    expect(state.junctions, hasLength(1));
    expect(state.corridorCancellation, isNull);

    state.applySnapshot(TripSnapshot.fromJson({
      'trip_id': 'TRIP-1',
      'status': 'cancelled',
      'route_version': 2,
      'destination': {'name': 'City Hospital', 'latitude': 12.935, 'longitude': 77.6245},
    }));

    expect(state.tripStatus, 'cancelled');
    expect(state.junctions, isEmpty, reason: 'stale priority must not survive');
    expect(state.corridorCancellation, isNotNull);
  });

  test('a live snapshot leaves the corridor flag alone', () {
    final state = AppState();
    state.applySnapshot(TripSnapshot.fromJson({
      'trip_id': 'TRIP-1',
      'status': 'corridor_active',
      'route_version': 2,
      'destination': {'name': 'City Hospital', 'latitude': 12.935, 'longitude': 77.6245},
    }));
    expect(state.corridorCancellation, isNull);
    expect(state.tripStatus, 'corridor_active');
  });

  test('emergency types match the spec categories', () {
    expect(emergencyTypes.keys, [
      'critical_medical',
      'non_critical_medical',
      'fire',
      'police',
      'organ_transport',
      'other',
    ]);
  });

  test('location ack parses backend response', () {
    final ack = LocationAck.fromJson({
      'accepted': true,
      'location_confidence': 0.94,
      'eta_seconds': 498,
      'route_version': 3,
    });
    expect(ack.accepted, isTrue);
    expect(ack.confidence, 0.94);
    expect(ack.etaSeconds, 498);
    expect(ack.routeVersion, 3);
  });

  test('priority junction parses signal status', () {
    final j = PriorityJunction.fromJson({
      'junction_id': 'J-12',
      'arrival_in_seconds': 52,
      'signal_status': 'preparing',
    });
    expect(j.junctionId, 'J-12');
    expect(j.arrivalInSeconds, 52);
    expect(j.signalStatus, 'preparing');
  });
}
