class LoginResult {
  LoginResult({
    required this.userId,
    required this.vehicleId,
    required this.role,
    required this.name,
    required this.organizationId,
  });

  final String userId;
  final String? vehicleId;
  final String role;
  final String name;
  final String organizationId;

  factory LoginResult.fromJson(Map<String, dynamic> j) => LoginResult(
        userId: j['user_id'] as String,
        vehicleId: j['vehicle_id'] as String?,
        role: j['role'] as String,
        name: (j['name'] ?? '') as String,
        organizationId: (j['organization_id'] ?? '') as String,
      );
}

class Vehicle {
  Vehicle({
    required this.id,
    required this.vehicleNumber,
    required this.vehicleType,
    required this.organizationId,
    required this.organizationName,
    this.driverId,
    this.driverName,
    required this.status,
    required this.verificationStatus,
  });

  final String id;
  final String vehicleNumber;
  final String vehicleType;
  final String organizationId;
  final String? organizationName;
  final String? driverId;
  final String? driverName;
  final String status;
  final String verificationStatus;

  String get typeLabel => switch (vehicleType) {
        'ambulance' => 'Ambulance',
        'fire_truck' => 'Fire Truck',
        'police' => 'Police',
        _ => vehicleType,
      };

  factory Vehicle.fromJson(Map<String, dynamic> j) => Vehicle(
        id: j['id'] as String,
        vehicleNumber: j['vehicle_number'] as String,
        vehicleType: j['vehicle_type'] as String,
        organizationId: j['organization_id'] as String,
        organizationName: j['organization_name'] as String?,
        driverId: j['driver_id'] as String?,
        driverName: j['driver_name'] as String?,
        status: j['status'] as String,
        verificationStatus: j['verification_status'] as String,
      );
}

class Destination {
  Destination({required this.name, required this.latitude, required this.longitude});

  final String name;
  final double latitude;
  final double longitude;

  Map<String, dynamic> toJson() =>
      {'name': name, 'latitude': latitude, 'longitude': longitude};

  factory Destination.fromJson(Map<String, dynamic> j) => Destination(
        name: j['name'] as String,
        latitude: (j['latitude'] as num).toDouble(),
        longitude: (j['longitude'] as num).toDouble(),
      );
}

class GpsFix {
  GpsFix({
    required this.latitude,
    required this.longitude,
    required this.accuracyM,
    required this.speedKmph,
    this.heading,
    this.batteryPercent,
    this.networkStatus = 'online',
    required this.timestamp,
    this.sequenceKey,
    this.source = 'gps',
    this.vehicleId,
    this.driverId,
  });

  final double latitude;
  final double longitude;
  final double accuracyM;
  final double speedKmph;
  final double? heading;
  final int? batteryPercent;
  final String networkStatus;
  final DateTime timestamp;
  final String? sequenceKey;
  final String source;
  final String? vehicleId;
  final String? driverId;

  Map<String, dynamic> toJson() => {
        'latitude': latitude,
        'longitude': longitude,
        'accuracy_m': accuracyM,
        'speed_kmph': speedKmph,
        if (heading != null) 'heading': heading,
        if (batteryPercent != null) 'battery_percent': batteryPercent,
        'network_status': networkStatus,
        'timestamp': timestamp.toUtc().toIso8601String(),
        if (sequenceKey != null) 'sequence_key': sequenceKey,
        'source': source,
        if (vehicleId != null) 'vehicle_id': vehicleId,
        if (driverId != null) 'driver_id': driverId,
      };
}

class RerouteResult {
  RerouteResult({
    required this.accepted,
    required this.routeVersion,
    required this.etaSeconds,
    required this.oldEtaSeconds,
    required this.reason,
    required this.message,
  });

  final bool accepted;
  final int routeVersion;
  final int etaSeconds;
  final int oldEtaSeconds;
  final String reason;
  final String message;

  factory RerouteResult.fromJson(Map<String, dynamic> j) => RerouteResult(
        accepted: j['accepted'] as bool? ?? false,
        routeVersion: (j['route_version'] as num).toInt(),
        etaSeconds: (j['eta_seconds'] as num).toInt(),
        oldEtaSeconds: (j['old_eta_seconds'] as num).toInt(),
        reason: (j['reason'] ?? '') as String,
        message: (j['message'] ?? '') as String,
      );
}

class StartTripResult {
  StartTripResult({required this.tripId, required this.status, required this.message});

  final String tripId;
  final String status;
  final String message;

  factory StartTripResult.fromJson(Map<String, dynamic> j) => StartTripResult(
        tripId: j['trip_id'] as String,
        status: j['status'] as String,
        message: (j['message'] ?? '') as String,
      );
}

class LocationAck {
  LocationAck({
    required this.accepted,
    this.reason,
    required this.confidence,
    this.etaSeconds,
    this.distanceRemainingM,
    this.routeVersion,
  });

  final bool accepted;
  final String? reason;
  final double confidence;
  final int? etaSeconds;
  final double? distanceRemainingM;
  final int? routeVersion;

  factory LocationAck.fromJson(Map<String, dynamic> j) => LocationAck(
        accepted: j['accepted'] as bool? ?? false,
        reason: j['reason'] as String?,
        confidence: (j['location_confidence'] as num?)?.toDouble() ?? 0,
        etaSeconds: (j['eta_seconds'] as num?)?.toInt(),
        distanceRemainingM: (j['distance_remaining_m'] as num?)?.toDouble(),
        routeVersion: (j['route_version'] as num?)?.toInt(),
      );
}

class PriorityJunction {
  PriorityJunction({
    required this.junctionId,
    required this.arrivalInSeconds,
    required this.signalStatus,
  });

  final String junctionId;
  final int arrivalInSeconds;
  final String signalStatus;

  factory PriorityJunction.fromJson(Map<String, dynamic> j) => PriorityJunction(
        junctionId: j['junction_id'] as String,
        arrivalInSeconds: (j['arrival_in_seconds'] as num?)?.toInt() ?? 0,
        signalStatus: (j['signal_status'] as String?) ?? 'scheduled',
      );
}

class IncidentReport {
  IncidentReport({
    required this.id,
    required this.type,
    required this.latitude,
    required this.longitude,
    this.description,
    required this.severity,
    required this.createdAt,
  });

  final int id;
  final String type;
  final double latitude;
  final double longitude;
  final String? description;
  final String severity;
  final DateTime createdAt;

  factory IncidentReport.fromJson(Map<String, dynamic> j) => IncidentReport(
        id: (j['id'] as num?)?.toInt() ?? 0,
        type: (j['incident_type'] ?? j['type'] ?? '') as String,
        latitude: (j['latitude'] as num).toDouble(),
        longitude: (j['longitude'] as num).toDouble(),
        description: j['description'] as String?,
        severity: (j['severity'] ?? 'medium') as String,
        createdAt: DateTime.parse(j['created_at'] as String),
      );
}

class TripSnapshot {
  TripSnapshot({
    required this.tripId,
    required this.status,
    required this.vehicleId,
    required this.emergencyType,
    required this.priority,
    required this.destination,
    required this.routeVersion,
    required this.routeGeometry,
    this.distanceMeters,
    this.distanceRemainingM,
    this.etaSeconds,
    required this.signalPlan,
    required this.incidents,
    this.lastLocation,
  });

  final String tripId;
  final String status;
  final String vehicleId;
  final String emergencyType;
  final String priority;
  final Destination destination;
  final int routeVersion;
  final List<List<double>> routeGeometry;
  final double? distanceMeters;
  final double? distanceRemainingM;
  final int? etaSeconds;
  final List<PriorityJunction> signalPlan;
  final List<IncidentReport> incidents;
  final Map<String, double>? lastLocation;

  factory TripSnapshot.fromJson(Map<String, dynamic> j) => TripSnapshot(
        tripId: j['trip_id'] as String,
        status: j['status'] as String,
        vehicleId: (j['vehicle_id'] ?? '') as String,
        emergencyType: (j['emergency_type'] ?? '') as String,
        priority: (j['priority'] ?? '') as String,
        destination: Destination.fromJson(j['destination'] as Map<String, dynamic>),
        routeVersion: (j['route_version'] as num?)?.toInt() ?? 0,
        routeGeometry: (j['route_geometry'] as List? ?? [])
            .map((p) => [
                  (p[0] as num).toDouble(),
                  (p[1] as num).toDouble(),
                ])
            .toList(),
        distanceMeters: (j['distance_meters'] as num?)?.toDouble(),
        distanceRemainingM: (j['distance_remaining_m'] as num?)?.toDouble(),
        etaSeconds: (j['eta_seconds'] as num?)?.toInt(),
        signalPlan: (j['signal_plan'] as List? ?? [])
            .map((x) => PriorityJunction.fromJson(x as Map<String, dynamic>))
            .toList(),
        incidents: (j['incidents'] as List? ?? [])
            .map((x) => IncidentReport.fromJson(x as Map<String, dynamic>))
            .toList(),
        lastLocation: j['last_location'] == null
            ? null
            : {
                'latitude': (j['last_location']['latitude'] as num).toDouble(),
                'longitude': (j['last_location']['longitude'] as num).toDouble(),
              },
      );
}

class TripSummary {
  TripSummary({
    required this.tripId,
    required this.status,
    this.completionStatus,
    required this.emergencyType,
    required this.priority,
    required this.destinationName,
    required this.routeVersion,
    required this.startedAt,
    this.completedAt,
    this.durationSeconds,
    required this.distanceTravelledM,
    this.originalEtaSeconds,
    this.finalEtaSeconds,
    required this.routeChanges,
    required this.incidents,
    required this.priorityJunctions,
    required this.signalPlanStatus,
  });

  final String tripId;
  final String status;
  final String? completionStatus;
  final String emergencyType;
  final String priority;
  final String destinationName;
  final int routeVersion;
  final DateTime startedAt;
  final DateTime? completedAt;
  final int? durationSeconds;
  final double distanceTravelledM;
  final int? originalEtaSeconds;
  final int? finalEtaSeconds;
  final int routeChanges;
  final List<IncidentReport> incidents;
  final List<PriorityJunction> priorityJunctions;
  final String signalPlanStatus;

  factory TripSummary.fromJson(Map<String, dynamic> j) => TripSummary(
        tripId: j['trip_id'] as String,
        status: j['status'] as String,
        completionStatus: j['completion_status'] as String?,
        emergencyType: (j['emergency_type'] ?? '') as String,
        priority: (j['priority'] ?? '') as String,
        destinationName: (j['destination_name'] ?? '') as String,
        routeVersion: (j['route_version'] as num?)?.toInt() ?? 1,
        startedAt: DateTime.parse(j['started_at'] as String),
        completedAt: j['completed_at'] == null
            ? null
            : DateTime.parse(j['completed_at'] as String),
        durationSeconds: (j['duration_seconds'] as num?)?.toInt(),
        distanceTravelledM: (j['distance_travelled_m'] as num?)?.toDouble() ?? 0,
        originalEtaSeconds: (j['original_eta_seconds'] as num?)?.toInt(),
        finalEtaSeconds: (j['eta_seconds'] as num?)?.toInt(),
        routeChanges: (j['route_changes'] as num?)?.toInt() ?? 0,
        incidents: (j['incidents'] as List? ?? [])
            .map((x) => IncidentReport.fromJson(x as Map<String, dynamic>))
            .toList(),
        priorityJunctions: (j['priority_junctions'] as List? ?? [])
            .map((x) => PriorityJunction.fromJson(x as Map<String, dynamic>))
            .toList(),
        signalPlanStatus: (j['signal_plan_status'] ?? 'none') as String,
      );
}

class HistoryTrip {
  HistoryTrip({
    required this.tripId,
    required this.vehicleId,
    required this.status,
    this.completionStatus,
    required this.emergencyType,
    required this.priority,
    required this.destinationName,
    required this.startedAt,
    this.completedAt,
  });

  final String tripId;
  final String vehicleId;
  final String status;
  final String? completionStatus;
  final String emergencyType;
  final String priority;
  final String destinationName;
  final DateTime startedAt;
  final DateTime? completedAt;

  factory HistoryTrip.fromJson(Map<String, dynamic> j) => HistoryTrip(
        tripId: j['trip_id'] as String,
        vehicleId: (j['vehicle_id'] ?? '') as String,
        status: (j['status'] ?? '') as String,
        completionStatus: j['completion_status'] as String?,
        emergencyType: (j['emergency_type'] ?? '') as String,
        priority: (j['priority'] ?? '') as String,
        destinationName: (j['destination_name'] ?? '') as String,
        startedAt: DateTime.parse(j['started_at'] as String),
        completedAt: j['completed_at'] == null
            ? null
            : DateTime.parse(j['completed_at'] as String),
      );
}

/// A pending central-system route change awaiting driver acknowledgement.
class RouteUpdateNotice {
  RouteUpdateNotice({
    required this.reason,
    required this.oldEtaSeconds,
    required this.newEtaSeconds,
    required this.routeVersion,
    required this.message,
  });

  final String reason;
  final int? oldEtaSeconds;
  final int? newEtaSeconds;
  final int routeVersion;
  final String message;
}

/// Draft of a trip request, carried from the start form through the
/// confirmation screen (spec screen 6) before anything hits the network.
class TripDraft {
  TripDraft({
    required this.destination,
    required this.emergencyType,
    required this.priority,
    this.notes,
    this.destinationContact,
    this.routeRestriction,
  });

  final Destination destination;
  final String emergencyType;
  final String priority;
  final String? notes;
  final String? destinationContact;
  final String? routeRestriction;

  /// Backend accepts free-text notes; contact and restrictions ride along
  /// as labelled text so no schema change is needed for optional fields.
  String? get mergedNotes {
    final parts = <String>[
      if (notes != null && notes!.isNotEmpty) notes!,
      if (destinationContact != null && destinationContact!.isNotEmpty)
        'Destination contact: $destinationContact',
      if (routeRestriction != null && routeRestriction!.isNotEmpty)
        'Route restriction: $routeRestriction',
    ];
    return parts.isEmpty ? null : parts.join(' | ');
  }
}

const emergencyTypes = <String, String>{
  'critical_medical': 'Critical medical',
  'non_critical_medical': 'Non-critical medical',
  'fire': 'Fire',
  'police': 'Police',
  'organ_transport': 'Organ transport',
  'other': 'Other',
};

const priorityLevels = <String, String>{
  'critical': 'Critical',
  'high': 'High',
  'normal': 'Normal',
};

const incidentTypes = <String, String>{
  'accident': 'Accident ahead',
  'road_blocked': 'Road blocked',
  'heavy_congestion': 'Heavy congestion',
  'wrong_route': 'Wrong route',
  'vehicle_issue': 'Vehicle issue',
  'destination_changed': 'Destination changed',
  'need_assistance': 'Need assistance',
};

/// End-of-trip reasons (spec screen 13) mapped to backend completion_status.
const endTripReasons = <String, String>{
  'completed': 'Completed',
  'cancelled': 'Cancelled',
  'diverted': 'Diverted',
  'patient_transferred': 'Patient transferred',
  'vehicle_issue': 'Vehicle issue',
  'other': 'Other',
};
