import './globals.css';

export const metadata = {
  title: 'Clinic Ops Agent',
  description: 'Autonomous agent for insurance authorization',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
