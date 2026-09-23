import type { Metadata } from 'next';
import { PilotDashboard } from './pilot-dashboard';

export const metadata: Metadata = {
  title: 'Pilot Operations | AI Business Platform',
  description: 'لوحة تشغيل Pilot للمبيعات والمخزون والتحويلات والذكاء الاصطناعي.',
};

export default function DashboardPage() {
  return <PilotDashboard />;
}
