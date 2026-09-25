import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../core/notify.dart';
import '../core/token_store.dart';
import '../core/ws_client.dart';
import '../models/models.dart';
import '../services/location_service.dart';

class AppState extends ChangeNotifier {
  AppState() {
    api = ApiClient();
    location = LocationService(api: api);
    api.onSessionExpired = () async {
      _loggedIn = false;
      user = null;
      notifyListeners();
    };
  }

  late final ApiClient api;
  late final LocationService location;

  // auth
  bool _loggedIn = false;
  bool get loggedIn => _loggedIn;
  LoginResult? user;
  String? authError;
  bool busy = false;

  // vehicles
  List<Vehicle> vehicles = [];
  Vehicle? selectedVehicle;

  // active trip
  String? activeTripId;
  String tripStatus = 'none'; // none|request_sent|route_calculating|...
  int routeVersion = 1;
  int? etaSeconds;
  double? distanceRemainingM;
  List<List<double>> routeGeometry = [];
  List<PriorityJunction> junctions = [];
  String destinationName = '';
  String emergencyType = '';
  String priority = '';
  TripSnapshot? tripSnapshot;

  // feed
  final List<Map<String, String>> messages = [];
  bool controlCenterOnline = true;
  bool wsConnected = false;
  RouteUpdateNotice? pendingRouteUpdate;

  /// Set when the control center kills the corridor mid-trip. Until the driver
  /// acknowledges it the app must not imply any junction still has priority.
  String? corridorCancellation;

  // history
  List<HistoryTrip> history = [];
  bool historyLoading = false;

  TripSocket? _socket;
  StreamSubscription? _locSub;
  Timer? _pollTimer;
  bool _wasOnline = true;
  bool _wasGpsLost = false;

  double get latitude => location.gps.latitude ?? 0;
  double get longitude => location.gps.longitude ?? 0;
  bool get hasFix => location.gps.latitude != null;

  Future<void> init() async {
    await api.init();
    await location.restoreQueue();
    if (await api.hasSession()) {
      try {
        _loggedIn = true;
        await loadVehicles();
        await _detectActiveTrip();
      } catch (_) {
        _loggedIn = false;
      }
    }
    _locSub ??= location.updates.listen((_) {
      // Notify only on transitions — GPS/network drops, not every tick.
      if (location.gps.gpsLost && !_wasGpsLost) {
        _wasGpsLost = true;
        Notify.urgent('GPS signal lost',
            'Location tracking paused. Move to open sky; queued fixes will upload when reception returns.');
      } else if (!location.gps.gpsLost && _wasGpsLost) {
        _wasGpsLost = false;
        Notify.info('GPS signal restored', 'Live tracking resumed.');
      }
      final onlineNow = location.online;
      if (!onlineNow && _wasOnline) {
        _wasOnline = false;
        Notify.urgent('Network unavailable',
            'Locations are being stored on-device until the connection returns.');
      } else if (onlineNow && !_wasOnline) {
        _wasOnline = true;
        Notify.info('Network restored', 'Queued locations are uploading now.');
      }
      notifyListeners();
    });
    notifyListeners();
  }

  // ---------- auth ----------

  Future<bool> login(String username, String password, String orgId) async {
    busy = true;
    authError = null;
    notifyListeners();
    try {
      user = await api.login(
        username: username,
        password: password,
        organizationId: orgId,
      );
      _loggedIn = true;
      await loadVehicles();
      busy = false;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      authError = e.message;
    } catch (_) {
      authError = 'Cannot reach the server. Check the address and network.';
    }
    busy = false;
    notifyListeners();
    return false;
  }

  Future<void> logout() async {
    await api.logout();
    user = null;
    _loggedIn = false;
    vehicles = [];
    selectedVehicle = null;
    messages.clear();
    notifyListeners();
  }

  Future<void> loadVehicles() async {
    vehicles = await api.vehicles();
    if (selectedVehicle == null && user?.vehicleId != null) {
      selectedVehicle =
          vehicles.where((v) => v.id == user!.vehicleId).firstOrNull;
    }
    selectedVehicle ??= vehicles.firstOrNull;
    notifyListeners();
  }

  /// Cold start with a trip still running server-side (app killed mid-trip):
  /// surface its ID so the splash/gate can resume it instead of showing home
  /// while the backend keeps rejecting new trips as duplicates.
  Future<void> _detectActiveTrip() async {
    try {
      final hist = await api.tripHistory();
      for (final t in hist) {
        if (t.completedAt == null &&
            t.status != 'completed' &&
            t.status != 'cancelled') {
          activeTripId = t.tripId;
          break;
        }
      }
    } catch (_) {
      // History unreachable — start without resume; the 409 on start-trip
      // still protects against a duplicate if one is hiding.
    }
    notifyListeners();
  }

  void selectVehicle(Vehicle v) {
    selectedVehicle = v;
    notifyListeners();
  }

  // ---------- trip ----------

  Future<String?> startTrip({
    required TripDraft draft,
    required GpsFix originFix,
  }) async {
    final vehicle = selectedVehicle;
    if (vehicle == null) return null;
    busy = true;
    notifyListeners();
    try {
      final result = await api.startTrip(
        vehicleId: vehicle.id,
        vehicleType: vehicle.vehicleType,
        emergencyType: draft.emergencyType,
        priority: draft.priority,
        destination: draft.destination,
        location: originFix,
        notes: draft.mergedNotes,
      );
      activeTripId = result.tripId;
      tripStatus = result.status;
      emergencyType = draft.emergencyType;
      priority = draft.priority;
      destinationName = draft.destination.name;
      routeVersion = 1;
      etaSeconds = null;
      distanceRemainingM = null;
      routeGeometry = [];
      junctions = [];
      pendingRouteUpdate = null;
      messages
        ..clear()
        ..add({'text': result.message, 'kind': 'info'});
      _connectSocket();
      await location.start(
        result.tripId,
        vehicle: vehicle.id,
        driver: user?.userId,
      );
      _startPolling();
      busy = false;
      notifyListeners();
      return result.tripId;
    } on ApiException catch (e) {
      messages.add({'text': e.message, 'kind': 'error'});
    } catch (_) {
      messages.add({'text': 'Failed to start trip. Server unreachable.', 'kind': 'error'});
    }
    busy = false;
    notifyListeners();
    return null;
  }

  void _connectSocket() {
    final trip = activeTripId;
    if (trip == null) return;
    _socket?.close();
    // Access token doubles as WS auth; refresh happens on reconnect by
    // re-reading storage inside login flows. For the prototype we grab it now.
    () async {
      final token = await TokenStore().accessToken();
      if (token == null || activeTripId != trip) return;
      _socket = TripSocket(baseUrl: api.baseUrl, tripId: trip, token: token);
      _socket!.messages.listen(_onSocketMessage);
      _socket!.connect();
    }();
  }

  /// Test seam: pushes a raw frame through the same handler the live socket
  /// uses, so feed/corridor behaviour can be checked without a server.
  @visibleForTesting
  void handleSocketMessage(Map<String, dynamic> msg) => _onSocketMessage(msg);

  void _onSocketMessage(Map<String, dynamic> msg) {
    final type = msg['type'] as String? ?? '';
    switch (type) {
      case 'connection':
        final wasOnline = wsConnected;
        wsConnected = msg['connected'] as bool? ?? false;
        controlCenterOnline = wsConnected;
        final text = msg['message'] as String?;
        if (text != null && text.isNotEmpty) {
          messages.add({'text': text, 'kind': wsConnected ? 'info' : 'warn'});
        }
        if (wasOnline && !wsConnected) {
          Notify.urgent('Control center disconnected',
              'Live updates interrupted. Polling continues in the background.');
        } else if (!wasOnline && wsConnected) {
          Notify.info('Control center reconnected', 'Live updates resumed.');
        }
      case 'snapshot':
        tripStatus = (msg['status'] as String?) ?? tripStatus;
        routeVersion = (msg['route_version'] as num?)?.toInt() ?? routeVersion;
        destinationName = (msg['destination'] as String?) ?? destinationName;
        _replaceJunctions(msg['priority_junctions']);
      case 'route_update':
        routeVersion = (msg['route_version'] as num?)?.toInt() ?? routeVersion;
        final oldEta = (msg['old_eta_seconds'] as num?)?.toInt();
        if (msg['eta_seconds'] != null) {
          etaSeconds = (msg['eta_seconds'] as num).toInt();
        }
        _replaceJunctions(msg['priority_junctions']);
        tripStatus = 'route_approved';
        _addMessage(msg['message']);
        final reason = msg['reason'] as String?;
        if (reason != null && reason.isNotEmpty) {
          // Operator-driven change: hold it for driver acknowledgement.
          pendingRouteUpdate = RouteUpdateNotice(
            reason: reason,
            oldEtaSeconds: oldEta,
            newEtaSeconds: (msg['eta_seconds'] as num?)?.toInt(),
            routeVersion: routeVersion,
            message: (msg['message'] as String?) ?? 'Route updated',
          );
          Notify.urgent('Route updated by control center',
              '$reason. New ETA: ${formatEta(etaSeconds)}.');
        } else {
          Notify.info('Route approved',
              'The central system approved your route.');
        }
      case 'status':
        tripStatus = (msg['status'] as String?) ?? tripStatus;
        _addMessage(msg['message']);
        _notifyStatusChange(tripStatus, msg['message'] as String?);
      case 'trip_status':
        tripStatus = (msg['status'] as String?) ?? tripStatus;
        _addMessage(msg['message']);
        _notifyStatusChange(tripStatus, msg['message'] as String?);
      case 'incident':
        _addMessage(msg['message']);
        Notify.urgent('Incident update',
            (msg['message'] as String?) ?? 'Control center sent an incident update.');
      case 'operator_message':
        final text = msg['message'] as String?;
        _addMessage(text);
        final urgent = (msg['urgency'] as String?) == 'urgent';
        if (urgent) {
          Notify.urgent('Control center — urgent',
              text ?? 'Urgent message from the control center.');
        } else {
          Notify.info('Control center', text ?? 'Message from the control center.');
        }
      case 'route_cancelled':
        final reason = msg['reason'] as String? ?? 'Cancelled by control center';
        _flagCorridorEnded(reason);
        _addMessage(msg['message'] ?? 'Route cancelled by control center. $reason');
        Notify.urgent('Route cancelled by control center',
            '$reason. Junction priority has been released — drive normally.');
      case 'location_update':
        if (msg['eta_seconds'] != null) {
          etaSeconds = (msg['eta_seconds'] as num).toInt();
        }
      default:
        _addMessage(msg['message']);
    }
    notifyListeners();
  }

  void _notifyStatusChange(String status, String? text) {
    switch (status) {
      case 'corridor_active':
        Notify.urgent('Green corridor active',
            text ?? 'Signal plan is running. Approach junctions at reduced speed.');
      case 'corridor_failed':
      case 'route_failed':
        Notify.urgent('Route update failed',
            text ?? 'The control center could not prepare the corridor.');
      case 'completed':
        Notify.info('Trip completed', text ?? 'The trip is closed.');
      case 'cancelled':
        Notify.urgent('Trip cancelled',
            text ?? 'This trip was cancelled by the control center.');
      default:
        break;
    }
  }

  void acknowledgeRouteUpdate() {
    pendingRouteUpdate = null;
    notifyListeners();
  }

  /// Driver acknowledges a control-center cancellation. The trip is already
  /// closed server-side, so there is nothing left to complete — stop GPS and
  /// clear the corridor, and the UI returns to the home screen.
  Future<void> acknowledgeCancellation() async {
    corridorCancellation = null;
    await _teardownTrip();
    notifyListeners();
  }

  /// Driver-initiated reroute (active trip screen).
  Future<void> reroute({required String reason}) async {
    final trip = activeTripId;
    if (trip == null) return;
    try {
      final result = await api.reroute(tripId: trip, reason: reason);
      routeVersion = result.routeVersion;
      etaSeconds = result.etaSeconds;
      pendingRouteUpdate = null;
      messages.add({'text': result.message, 'kind': 'info'});
      await refreshTrip();
    } on ApiException catch (e) {
      messages.add({'text': e.message, 'kind': 'error'});
    } catch (_) {
      messages.add({'text': 'Reroute request failed. Control center unreachable.', 'kind': 'error'});
    }
    notifyListeners();
  }

  Future<void> loadHistory() async {
    if (historyLoading) return;
    historyLoading = true;
    notifyListeners();
    try {
      history = await api.tripHistory();
    } on ApiException catch (e) {
      messages.add({'text': e.message, 'kind': 'error'});
    } catch (_) {
      messages.add({'text': 'Could not load trip history.', 'kind': 'error'});
    }
    historyLoading = false;
    notifyListeners();
  }

  /// Ask the control center for human assistance (screen 12).
  Future<IncidentReport?> requestAssistance({String? note}) async {
    return reportIncident(
      type: 'need_assistance',
      description: note ?? 'Driver requested assistance from the control center.',
      severity: 'high',
    );
  }

  void _replaceJunctions(dynamic raw) {
    if (raw is! List) return;
    final parsed = raw
        .map((x) => PriorityJunction.fromJson(x as Map<String, dynamic>))
        .toList();
    if (parsed.isNotEmpty) junctions = parsed;
  }

  void _addMessage(dynamic text) {
    if (text == null) return;
    final s = text.toString();
    if (s.isEmpty) return;
    messages.add({'text': s, 'kind': 'info'});
    if (messages.length > 50) messages.removeAt(0);
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 10), (_) => refreshTrip());
  }

  Future<void> refreshTrip() async {
    final trip = activeTripId;
    if (trip == null) return;
    try {
      final snap = await api.trip(trip);
      applySnapshot(snap);
    } on ApiException catch (e) {
      // 404/409: the server has no open trip left for us (cancelled or
      // completed elsewhere). Same treatment as a cancellation frame, so the
      // driver is told instead of just seeing the status flip to "Offline".
      if (e.statusCode == 404 || e.statusCode == 409) {
        _flagCorridorEnded('This trip was closed by the control center.');
        return;
      }
      controlCenterOnline = false;
      notifyListeners();
    } catch (_) {
      controlCenterOnline = false;
      notifyListeners();
    }
  }

  /// One place for "this corridor is over": drop the junction plan first so a
  /// stale priority can never be shown, then surface the reason to the driver.
  void _flagCorridorEnded(String reason) {
    // Keep the first reason the driver was shown — a later poll must not
    // overwrite it with the generic fallback text.
    corridorCancellation ??= reason;
    tripStatus = 'cancelled';
    junctions = [];
    pendingRouteUpdate = null;
    _addMessage(reason);
    notifyListeners();
  }

  void applySnapshot(TripSnapshot snap) {
    tripSnapshot = snap;
    tripStatus = snap.status;
    routeVersion = snap.routeVersion;
    etaSeconds = snap.etaSeconds ?? etaSeconds;
    distanceRemainingM = snap.distanceRemainingM;
    if (snap.routeGeometry.isNotEmpty) routeGeometry = snap.routeGeometry;
    if (snap.signalPlan.isNotEmpty) junctions = snap.signalPlan;
    controlCenterOnline = true;
    // Polling is the fallback when the socket is down, so it has to catch a
    // trip that closed while we were disconnected.
    if (snap.status == 'cancelled' && corridorCancellation == null) {
      _flagCorridorEnded('This trip was cancelled by the control center.');
      return;
    }
    notifyListeners();
  }

  Future<IncidentReport?> reportIncident({
    required String type,
    String? description,
    String severity = 'medium',
  }) async {
    final trip = activeTripId;
    if (trip == null) return null;
    final lat = location.gps.latitude;
    final lon = location.gps.longitude;
    if (lat == null || lon == null) return null;
    try {
      final report = await api.reportIncident(
        tripId: trip,
        type: type,
        latitude: lat,
        longitude: lon,
        description: description,
        severity: severity,
      );
      messages.add({
        'text': 'Incident reported: ${type.replaceAll('_', ' ')}. Control center notified.',
        'kind': 'info',
      });
      notifyListeners();
      return report;
    } on ApiException catch (e) {
      messages.add({'text': e.message, 'kind': 'error'});
      notifyListeners();
      return null;
    }
  }

  Future<TripSummary?> endTrip(String completionStatus) async {
    final trip = activeTripId;
    if (trip == null) return null;
    busy = true;
    notifyListeners();
    try {
      final summary = await api.completeTrip(
        tripId: trip,
        completionStatus: completionStatus,
        latitude: location.gps.latitude ?? 0,
        longitude: location.gps.longitude ?? 0,
      );
      await _teardownTrip();
      busy = false;
      notifyListeners();
      return summary;
    } on ApiException catch (e) {
      messages.add({'text': e.message, 'kind': 'error'});
    } catch (_) {
      messages.add({'text': 'Could not reach the control center to end the trip.', 'kind': 'error'});
    }
    busy = false;
    notifyListeners();
    return null;
  }

  Future<void> _teardownTrip() async {
    _pollTimer?.cancel();
    _pollTimer = null;
    _socket?.close();
    _socket = null;
    wsConnected = false;
    await location.stop();
    await location.clearQueue();
    activeTripId = null;
    tripStatus = 'none';
    routeGeometry = [];
    junctions = [];
    etaSeconds = null;
    distanceRemainingM = null;
    pendingRouteUpdate = null;
    corridorCancellation = null;
  }

  /// Resume a trip after app restart (crash / swipe away).
  Future<bool> resumeTrip(String tripId) async {
    try {
      activeTripId = tripId;
      final snap = await api.trip(tripId);
      if (snap.status == 'completed' || snap.status == 'cancelled') {
        activeTripId = null;
        return false;
      }
      applySnapshot(snap);
      emergencyType = snap.emergencyType;
      priority = snap.priority;
      destinationName = snap.destination.name;
      _connectSocket();
      await location.start(
        tripId,
        vehicle: selectedVehicle?.id ?? user?.vehicleId,
        driver: user?.userId,
      );
      _startPolling();
      notifyListeners();
      return true;
    } catch (_) {
      activeTripId = null;
      return false;
    }
  }

  String formatEta(int? seconds) {
    if (seconds == null) return '--:--';
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')} min ${s.toString().padLeft(2, '0')} sec';
  }

  String get statusLabel => switch (tripStatus) {
        'request_sent' => 'Request sent',
        'request_received' => 'Request received',
        'route_calculating' => 'Route being calculated',
        'route_approved' => 'Route approved',
        'corridor_preparing' => 'Green corridor preparing',
        'corridor_active' => 'Green corridor active',
        'rerouting' => 'Route recalculating',
        'completed' => 'Trip completed',
        'cancelled' => 'Trip cancelled',
        _ => 'Standing by',
      };

  @override
  void dispose() {
    _locSub?.cancel();
    _pollTimer?.cancel();
    _socket?.close();
    api.dispose();
    super.dispose();
  }
}
