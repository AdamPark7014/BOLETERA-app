import type { InviteTeamMemberInput } from '@/lib/queries/organization';

export type InviteForm = InviteTeamMemberInput;

export const INITIAL_INVITE: InviteForm = {
  email: '',
  firstName: '',
  lastName: '',
  role: 'TAQUILLA',
  password: '',
};
