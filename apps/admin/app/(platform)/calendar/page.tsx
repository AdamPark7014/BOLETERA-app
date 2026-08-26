'use client';

import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import CalendarEnterprise from './CalendarEnterprise';

export default function CalendarPage() {
  const session = useSession();

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;

  return <CalendarEnterprise />;
}
