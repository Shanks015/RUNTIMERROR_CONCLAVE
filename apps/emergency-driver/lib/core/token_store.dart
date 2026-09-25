import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tokens never touch plaintext prefs — flutter_secure_storage uses the
/// Android Keystore (EncryptedSharedPreferences under the hood).
class TokenStore {
  static const _accessKey = 'access_token';
  static const _refreshKey = 'refresh_token';
  static const _serverKey = 'server_url';

  // v11 defaults: AES-GCM backed by the Android Keystore — no plaintext prefs.
  static const _storage = FlutterSecureStorage();

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  Future<String?> accessToken() => _storage.read(key: _accessKey);
  Future<String?> refreshToken() => _storage.read(key: _refreshKey);

  Future<void> clear() => _storage.deleteAll();

  Future<void> saveServerUrl(String url) =>
      _storage.write(key: _serverKey, value: url);

  Future<String?> serverUrl() => _storage.read(key: _serverKey);
}
