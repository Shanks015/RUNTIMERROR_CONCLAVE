/// Connection settings for the driver app.
///
/// The phone must reach this host on the LAN (or over the internet if you
/// expose the backend). Override at runtime from the login screen.
class AppConfig {
  static const String defaultBaseUrl = 'http://10.63.71.37:8010';
  static const Duration locationInterval = Duration(seconds: 4);
  static const Duration wsReconnectDelay = Duration(seconds: 3);
  static const String wsPath = '/ws/emergency-trips';
}
