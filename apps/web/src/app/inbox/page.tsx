import type { Metadata } from 'next';
import { InboxClient } from './inbox-client';

export const metadata: Metadata = {
  title: 'الصندوق الداخلي | AI Business Platform',
  description: 'مساحة الموظف لاستلام محادثات العملاء ومتابعتها.',
};

export default function InboxPage() {
  return <InboxClient />;
}
