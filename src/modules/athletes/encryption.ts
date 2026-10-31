import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Players are minors (NFR-001, R23): their names and birth date are encrypted at rest.
 *
 * Consequence for every read path: these columns are never sorted, filtered with `$ilike`
 * or exported by the database. A club has one team of at most ~35 players in the MVP
 * (D206), so the UI sorts and searches names client-side after decryption.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'athletes:athletes_player',
    fields: [{ field: 'first_name' }, { field: 'last_name' }, { field: 'birth_date' }],
  },
]

export default defaultEncryptionMaps
