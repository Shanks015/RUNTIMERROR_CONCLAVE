import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/notify.dart';
import 'screens/active_trip_screen.dart';
import 'screens/assistance_screen.dart';
import 'screens/home_screen.dart';
import 'screens/incident_screen.dart';
import 'screens/login_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/start_trip_screen.dart';
import 'screens/trip_complete_screen.dart';
import 'screens/trip_confirm_screen.dart';
import 'screens/trip_history_screen.dart';
import 'screens/trip_processing_screen.dart';
import 'screens/vehicle_select_screen.dart';
import 'state/app_state.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  Notify.init();
  runApp(
    ChangeNotifierProvider(
      create: (_) => AppState()..init(),
      child: const ResQConnectApp(),
    ),
  );
}

class ResQConnectApp extends StatelessWidget {
  const ResQConnectApp({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFFC62828),
      brightness: Brightness.dark,
    );

    return MaterialApp(
      title: 'ResQConnect',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: const Color(0xFF121212),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1A1A1A),
          centerTitle: false,
          titleTextStyle: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
        cardTheme: CardThemeData(
          color: const Color(0xFF1E1E1E),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
        inputDecorationTheme: const InputDecorationTheme(
          filled: true,
          fillColor: Color(0xFF1E1E1E),
        ),
        snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
      ),
      home: const SplashScreen(),
      routes: {
        '/login': (_) => const LoginScreen(),
        '/home': (_) => const HomeScreen(),
        '/vehicles': (_) => const VehicleSelectScreen(),
        '/start-trip': (_) => const StartTripScreen(),
        '/confirm': (_) => const TripConfirmScreen(),
        '/processing': (_) => const TripProcessingScreen(),
        '/active-trip': (_) => const ActiveTripScreen(),
        '/incident': (_) => const IncidentScreen(),
        '/assistance': (_) => const AssistanceScreen(),
        '/history': (_) => const TripHistoryScreen(),
        '/trip-complete': (_) => const TripCompleteScreen(),
      },
    );
  }
}
