import type { useT } from '@open-mercato/shared/lib/i18n/context'

type Translate = ReturnType<typeof useT>

/**
 * Club role names as stored in the installed `auth` module. These are machine
 * identifiers sent to `/api/auth/users`; authorization stays feature-based on the server.
 */
export const CLUB_ROLES = ['club_admin', 'coach', 'director'] as const

export type ClubRole = (typeof CLUB_ROLES)[number]

export function isClubRole(value: unknown): value is ClubRole {
  return typeof value === 'string' && (CLUB_ROLES as readonly string[]).includes(value)
}

export function clubRoleLabel(role: ClubRole, t: Translate): string {
  switch (role) {
    case 'club_admin':
      return t('athletes.roles.club_admin', 'Administrator klubu')
    case 'coach':
      return t('athletes.roles.coach', 'Trener')
    case 'director':
      return t('athletes.roles.director', 'Dyrektor')
  }
}

export function clubRoleOptions(t: Translate): Array<{ value: ClubRole; label: string }> {
  return CLUB_ROLES.map((role) => ({ value: role, label: clubRoleLabel(role, t) }))
}
