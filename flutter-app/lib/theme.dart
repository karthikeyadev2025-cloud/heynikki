// lib/theme.dart — Hey Nikki brand theme
import 'package:flutter/material.dart';

class HeyNikkiColors {
  static const bg       = Color(0xFF07070F);
  static const surface  = Color(0xFF0D0D1A);
  static const high     = Color(0xFF13132A);
  static const border   = Color(0xFF1E1E3A);
  static const orange   = Color(0xFFF97316);
  static const teal     = Color(0xFF10B981);
  static const purple   = Color(0xFF8B5CF6);
  static const gold     = Color(0xFFF59E0B);
  static const red      = Color(0xFFEF4444);
  static const text     = Color(0xFFF0F0FF);
  static const mid      = Color(0xFF9090B0);
  static const dim      = Color(0xFF44445A);
  static const gradient = LinearGradient(
    colors: [orange, teal],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}

class HeyNikkiTheme {
  static ThemeData get dark => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: HeyNikkiColors.bg,
    colorScheme: const ColorScheme.dark(
      primary: HeyNikkiColors.teal,
      secondary: HeyNikkiColors.orange,
      surface: HeyNikkiColors.surface,
      error: HeyNikkiColors.red,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: HeyNikkiColors.surface,
      foregroundColor: HeyNikkiColors.text,
      elevation: 0,
      titleTextStyle: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: HeyNikkiColors.text),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: HeyNikkiColors.high,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: HeyNikkiColors.border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: HeyNikkiColors.border)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: HeyNikkiColors.teal, width: 1.5)),
      labelStyle: const TextStyle(color: HeyNikkiColors.mid),
      hintStyle: const TextStyle(color: HeyNikkiColors.dim),
    ),
    cardTheme: CardTheme(
      color: HeyNikkiColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: HeyNikkiColors.border)),
      elevation: 0,
    ),
  );
}
