import './globals.css';

export const metadata = {
  title: 'Clinic Ops Agent',
  description: 'Autonomous agent for insurance authorization',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
