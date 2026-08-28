import 'package:flutter/material.dart';
import '../theme.dart';

class HeyNikkiLogo extends StatelessWidget {
  final double size;
  final bool showText;
  const HeyNikkiLogo({super.key, this.size = 40, this.showText = true});
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: size, height: size,
        decoration: BoxDecoration(gradient: HeyNikkiColors.gradient, borderRadius: BorderRadius.circular(size * 0.25)),
        child: Center(child: Text('N', style: TextStyle(color: Colors.white, fontSize: size * 0.55, fontWeight: FontWeight.w900))),
      ),
      if (showText) ...[
        const SizedBox(width: 10),
        Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          ShaderMask(
            shaderCallback: (b) => HeyNikkiColors.gradient.createShader(b),
            child: Text('HeyNikki', style: TextStyle(fontSize: size * 0.45, fontWeight: FontWeight.w900, color: Colors.white)),
          ),
          Text('Nikki Technologies', style: TextStyle(fontSize: size * 0.18, color: HeyNikkiColors.dim, letterSpacing: 1)),
        ]),
      ],
    ],
  );
}

class HeyNikkiCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets? padding;
  final Color? borderColor;
  const HeyNikkiCard({super.key, required this.child, this.padding, this.borderColor});
  @override
  Widget build(BuildContext context) => Container(
    padding: padding ?? const EdgeInsets.all(16),
    decoration: BoxDecoration(color: HeyNikkiColors.surface, borderRadius: BorderRadius.circular(12),
      border: Border.all(color: borderColor ?? HeyNikkiColors.border)),
    child: child,
  );
}

class HeyNikkiButton extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;
  final bool loading;
  const HeyNikkiButton({super.key, required this.label, this.onTap, this.loading = false});
  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: loading ? null : onTap,
    child: Container(
      width: double.infinity, height: 50,
      decoration: BoxDecoration(
        gradient: loading ? null : HeyNikkiColors.gradient,
        color: loading ? HeyNikkiColors.high : null,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Center(child: loading
        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: HeyNikkiColors.teal))
        : Text(label, style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w700))),
    ),
  );
}

class HeyNikkiPill extends StatelessWidget {
  final String label;
  final Color color;
  const HeyNikkiPill({super.key, required this.label, required this.color});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(4),
      border: Border.all(color: color.withOpacity(0.4))),
    child: Text(label.toUpperCase(), style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
  );
}

class HeyNikkiStat extends StatelessWidget {
  final String value, label;
  final Color color;
  const HeyNikkiStat({super.key, required this.value, required this.label, required this.color});
  @override
  Widget build(BuildContext context) => HeyNikkiCard(
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 10, letterSpacing: 0.8)),
      const SizedBox(height: 6),
      Text(value, style: TextStyle(color: color, fontSize: 24, fontWeight: FontWeight.w900)),
    ]),
  );
}
