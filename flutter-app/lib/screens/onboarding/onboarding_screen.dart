import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _controller = PageController();
  int _page = 0;

  final _pages = [
    _OnboardPage(
      icon: '🏢',
      title: 'Your Business Never\nMisses a Call',
      subtitle: 'Hey Nikki answers every call in Telugu — 24/7, automatically.',
      gradient: true,
    ),
    _OnboardPage(
      icon: '🗣️',
      title: 'Native Telugu AI\nReceptionist',
      subtitle: 'Understands Tanglish, books appointments, sends WhatsApp confirmations.',
      gradient: false,
    ),
    _OnboardPage(
      icon: '⚡',
      title: 'Go Live in\n60 Seconds',
      subtitle: 'Upload your number. Pick a voice profile. Done.',
      gradient: true,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Logo top
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const HeyNikkiLogo(size: 36),
                  TextButton(
                    onPressed: () => context.go('/login'),
                    child: const Text('Sign In', style: TextStyle(color: HeyNikkiColors.teal, fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ),
            // Pages
            Expanded(
              child: PageView.builder(
                controller: _controller,
                onPageChanged: (i) => setState(() => _page = i),
                itemCount: _pages.length,
                itemBuilder: (_, i) => _pages[i],
              ),
            ),
            // Dots + buttons
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
              child: Column(
                children: [
                  // Dots
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(_pages.length, (i) => AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      width: _page == i ? 24 : 8,
                      height: 8,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(4),
                        gradient: _page == i ? HeyNikkiColors.gradient : null,
                        color: _page == i ? null : HeyNikkiColors.border,
                      ),
                    )),
                  ),
                  const SizedBox(height: 24),
                  if (_page < _pages.length - 1)
                    HeyNikkiButton(
                      label: 'Next →',
                      onTap: () => _controller.nextPage(duration: const Duration(milliseconds: 300), curve: Curves.easeInOut),
                    )
                  else
                    Column(children: [
                      HeyNikkiButton(label: 'Start Free Trial', onTap: () => context.go('/signup')),
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: () => context.go('/login'),
                        child: const Text('Already have an account? Sign In', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 13)),
                      ),
                    ]),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardPage extends StatelessWidget {
  final String icon, title, subtitle;
  final bool gradient;
  const _OnboardPage({required this.icon, required this.title, required this.subtitle, required this.gradient});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 40),
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 100, height: 100,
          decoration: BoxDecoration(
            gradient: gradient ? HeyNikkiColors.gradient : null,
            color: gradient ? null : HeyNikkiColors.surface,
            borderRadius: BorderRadius.circular(28),
            border: gradient ? null : Border.all(color: HeyNikkiColors.border),
          ),
          child: Center(child: Text(icon, style: const TextStyle(fontSize: 44))),
        ),
        const SizedBox(height: 36),
        Text(title,
          textAlign: TextAlign.center,
          style: const TextStyle(color: HeyNikkiColors.text, fontSize: 28, fontWeight: FontWeight.w900, height: 1.2)),
        const SizedBox(height: 16),
        Text(subtitle,
          textAlign: TextAlign.center,
          style: const TextStyle(color: HeyNikkiColors.mid, fontSize: 15, height: 1.6)),
      ],
    ),
  );
}
