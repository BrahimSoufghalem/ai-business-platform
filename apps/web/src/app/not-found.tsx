import Link from 'next/link';

export default function GlobalNotFound() {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 48, textAlign: 'center' }}>
        <h1>404</h1>
        <p>
          <Link href="/">AI Business Platform</Link>
        </p>
      </body>
    </html>
  );
}
