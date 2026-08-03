import VoiceAssistant from "../components/VoiceAssistant";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* 🤖 Nikki voice assistant — ask about your business data anytime */}
        <VoiceAssistant />
      </body>
    </html>
  );
}
