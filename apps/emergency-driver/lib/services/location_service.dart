import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:battery_plus/battery_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api_client.dart';
import '../models/models.dart';

class GpsStatus {
  bool serviceEnabled = false;
  LocationPermission permission = LocationPermission.denied;
  double? accuracyM;
  double? speedKmph;
  double? heading;
  double? latitude;
  double? longitude;
  bool gpsLost = false;
}

enum TrackerState { idle, requesting, active, stopped }

/// Streams GPS while a trip is active, POSTs every fix, and queues failures
/// (with client-generated sequence keys) until the network returns.
class LocationService {
  LocationService({required this.api});

  final ApiClient api;

  final _gps = GpsStatus();
  GpsStatus get gps => _gps;

  TrackerState state = TrackerState.idle;
  int batteryPercent = 0;
  bool online = true;
  int queuedCount = 0;
  double lastConfidence = 0;
  int? lastEtaSeconds;
  String? lastRejectReason;

  StreamSubscription<Position>? _posSub;
  StreamSubscription<List<ConnectivityResult>>? _connSub;
  Timer? _flushTimer;
  Timer? _batteryTimer;
  String? _tripId;

  final _queue = <Map<String, dynamic>>[];
  final _controller = StreamController<void>.broadcast();
  Stream<void> get updates => _controller.stream;

  final _battery = Battery();

  // Trip identity stamped on every payload (spec section 7).
  String? vehicleId;
  String? driverId;

  Future<void> ensurePermissions() async {
    _gps.serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!_gps.serviceEnabled) {
      state = TrackerState.idle;
      _emit();
      return;
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    _gps.permission = perm;
    if (perm == LocationPermission.denied) {
      state = TrackerState.idle;
    }
    _emit();
  }

  Future<bool> get canTrack =>
      Future(() async => _gps.serviceEnabled &&
          (_gps.permission == LocationPermission.always ||
              _gps.permission == LocationPermission.whileInUse));

  /// Current best fix without starting a stream (used for trip start).
  Future<Position?> currentFix() async {
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: _androidSettings(),
      ).timeout(const Duration(seconds: 12));
    } catch (_) {
      return null;
    }
  }

  AndroidSettings _androidSettings() => AndroidSettings(
        intervalDuration: const Duration(seconds: 4),
        forceLocationManager: false,
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Emergency trip in progress',
          notificationText: 'Sending GPS updates to the control center',
          notificationChannelName: 'Emergency location tracking',
          notificationIcon: AndroidResource(
            name: 'ic_launcher',
            defType: 'mipmap',
          ),
          setOngoing: true,
          enableWakeLock: true,
        ),
      );

  Future<void> start(String tripId, {String? vehicle, String? driver}) async {
    await stop();
    _tripId = tripId;
    vehicleId = vehicle;
    driverId = driver;
    await ensurePermissions();
    if (!await canTrack) {
      state = TrackerState.idle;
      _emit();
      return;
    }

    state = TrackerState.requesting;
    _emit();

    _posSub = Geolocator.getPositionStream(locationSettings: _androidSettings())
        .listen(_onPosition, onError: (_) => _markGpsLost());

    _connSub ??= Connectivity().onConnectivityChanged.listen((results) {
      final wasOnline = online;
      online = results.any((r) => r != ConnectivityResult.none);
      if (online && !wasOnline) _flushQueue();
      _emit();
    });
    _batteryTimer ??= Timer.periodic(
      const Duration(seconds: 30),
      (_) => _readBattery(),
    );
    await _readBattery();

    _flushTimer ??= Timer.periodic(const Duration(seconds: 5), (_) => _flushQueue());

    state = TrackerState.active;
    _emit();
  }

  Future<void> stop() async {
    await _posSub?.cancel();
    _posSub = null;
    _flushTimer?.cancel();
    _flushTimer = null;
    _batteryTimer?.cancel();
    _batteryTimer = null;
    await _connSub?.cancel();
    _connSub = null;
    _tripId = null;
    state = TrackerState.stopped;
    _gps.gpsLost = false;
    _emit();
  }

  Future<void> _readBattery() async {
    try {
      batteryPercent = await _battery.batteryLevel;
    } catch (_) {
      // Some emulators don't implement the battery service; keep last value.
    }
    _emit();
  }

  void _onPosition(Position pos) {
    _gps
      ..serviceEnabled = true
      ..gpsLost = false
      ..accuracyM = pos.accuracy
      ..speedKmph = pos.speed * 3.6
      ..heading = pos.heading
      ..latitude = pos.latitude
      ..longitude = pos.longitude;
    lastRejectReason = null;

    final fix = GpsFix(
      latitude: pos.latitude,
      longitude: pos.longitude,
      accuracyM: pos.accuracy,
      speedKmph: max(0, pos.speed * 3.6),
      heading: pos.heading.isFinite ? pos.heading : null,
      batteryPercent: batteryPercent,
      networkStatus: online ? 'online' : 'offline',
      timestamp: DateTime.now(),
      sequenceKey:
          'gps-${pos.timestamp.millisecondsSinceEpoch}-${pos.latitude.toStringAsFixed(5)}',
      vehicleId: vehicleId,
      driverId: driverId,
    );
    _send(fix);
    _emit();
  }

  void _markGpsLost() {
    _gps.gpsLost = true;
    _emit();
  }

  Future<void> _send(GpsFix fix) async {
    final trip = _tripId;
    if (trip == null) return;
    if (!online) {
      _enqueue(fix);
      return;
    }
    try {
      final ack = await api.sendLocation(trip, fix);
      if (ack.accepted) {
        lastConfidence = ack.confidence;
        lastEtaSeconds = ack.etaSeconds ?? lastEtaSeconds;
      } else {
        lastRejectReason = ack.reason;
        // Rejected fixes that aren't duplicates are worth one retry later.
        if (ack.reason != 'duplicate_update') _enqueue(fix);
      }
    } on ApiException catch (e) {
      // 404/409 mean the server no longer has an open trip for us — the trip
      // was cancelled or completed elsewhere. Queueing would keep the GPS
      // stream running against a dead trip and wrongly flag the app offline,
      // so end tracking instead of retrying forever. AppState surfaces the
      // reason to the driver from its own poll / socket path.
      if (e.statusCode == 404 || e.statusCode == 409) {
        await stop();
        return;
      }
      _enqueue(fix);
    } catch (_) {
      _enqueue(fix);
      // The queue flusher will retry; also flip the flag if we know we're offline.
      if (queuedCount > 3 && online) {
        online = false;
      }
    }
    _emit();
  }

  void _enqueue(GpsFix fix) {
    _queue.add(fix.toJson());
    _persistQueue();
  }

  Future<void> _flushQueue() async {
    if (_queue.isEmpty || _tripId == null) return;
    if (!online) {
      try {
        final results = await Connectivity().checkConnectivity();
        online = results.any((r) => r != ConnectivityResult.none);
      } catch (_) {
        return;
      }
      if (!online) return;
    }
    // Drain oldest-first; stop on first hard failure to preserve order.
    while (_queue.isNotEmpty) {
      final item = _queue.first;
      try {
        final ack = await api.sendLocation(
          _tripId!,
          GpsFix(
            latitude: (item['latitude'] as num).toDouble(),
            longitude: (item['longitude'] as num).toDouble(),
            accuracyM: (item['accuracy_m'] as num).toDouble(),
            speedKmph: (item['speed_kmph'] as num?)?.toDouble() ?? 0,
            heading: (item['heading'] as num?)?.toDouble(),
            batteryPercent: (item['battery_percent'] as num?)?.toInt(),
            networkStatus: item['network_status'] as String? ?? 'offline',
            timestamp: DateTime.parse(item['timestamp'] as String),
            sequenceKey: item['sequence_key'] as String?,
            source: item['source'] as String? ?? 'gps',
            vehicleId: item['vehicle_id'] as String? ?? vehicleId,
            driverId: item['driver_id'] as String? ?? driverId,
          ),
        );
        if (!ack.accepted && ack.reason != 'duplicate_ignored' && ack.reason != 'duplicate_update') {
          break; // server refuses this point; keep it, report on next tick
        }
        _queue.removeAt(0);
        if (ack.accepted && ack.confidence > 0) lastConfidence = ack.confidence;
      } on ApiException catch (e) {
        // Closed trip: the queue can never drain, so drop it rather than
        // reporting a permanent fake offline state.
        if (e.statusCode == 404 || e.statusCode == 409) {
          _queue.clear();
          await stop();
          return;
        }
        online = false;
        break;
      } catch (_) {
        online = false;
        break;
      }
    }
    queuedCount = _queue.length;
    await _persistQueue();
    _emit();
  }

  Future<void> _persistQueue() async {
    queuedCount = _queue.length;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('gps_queue', jsonEncode(_queue));
    } catch (_) {
      // Queue stays in memory; not worth failing the tracker over prefs I/O.
    }
  }

  /// Restore queued fixes from a previous run (app killed mid-trip).
  Future<void> restoreQueue() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('gps_queue');
      if (raw == null || raw.isEmpty) return;
      final list = jsonDecode(raw) as List;
      _queue
        ..clear()
        ..addAll(list.cast<Map<String, dynamic>>());
      queuedCount = _queue.length;
      _emit();
    } catch (_) {
      // Corrupt queue: drop it rather than poison future flushes.
      _queue.clear();
      queuedCount = 0;
    }
  }

  Future<void> clearQueue() async {
    _queue.clear();
    queuedCount = 0;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('gps_queue');
    _emit();
  }

  void _emit() {
    if (!_controller.isClosed) _controller.add(null);
  }
}
