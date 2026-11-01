import { describe, expect, it } from '@jest/globals'
import { createHash } from 'node:crypto'
import { DAILY_FILE_ERRORS } from '../dailyFileParser'
import { DAILY_UPLOAD_ERRORS, MAX_MULTIPART_BYTES, readAssignments, readDailyUpload, readTeamId } from '../dailyImportUpload'
import { toTrainingSessionView } from '../dailyImportView'
import type { AthletesTrainingSession } from '../../data/entities'

function multipart(fields: Record<string, string | Blob>, fileName = 'rpe.csv'): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Blob) form.append(key, value, fileName)
    else form.append(key, value)
  }
  return new Request('http://localhost/api/athletes/daily-imports/preview', { method: 'POST', body: form })
}

describe('readDailyUpload', () => {
  it('parses the file and hashes its bytes', async () => {
    const csv = 'Zawodnik;Data;Nr sesji;Minuty;RPE\nJan Kowalski;20.10.2026;1;60;7\n'
    const upload = await readDailyUpload(multipart({ kind: 'rpe', teamId: '', file: new Blob([csv]) }))
    expect(upload.fileName).toBe('rpe.csv')
    expect(upload.fileHash).toBe(createHash('sha256').update(csv).digest('hex'))
    expect(upload.table.rows).toHaveLength(1)
    expect(readTeamId(upload.form)).toBeNull()
  })

  it('rejects a non-multipart request (415), a missing file and a wrong kind (400)', async () => {
    await expect(readDailyUpload(new Request('http://localhost/x', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })))
      .rejects.toMatchObject({ status: 415, body: { error: DAILY_FILE_ERRORS.unsupportedType } })
    await expect(readDailyUpload(multipart({ kind: 'rpe' }))).rejects.toMatchObject({ status: 400, body: { error: DAILY_UPLOAD_ERRORS.fileRequired } })
    await expect(readDailyUpload(multipart({ kind: 'wellbeing', file: new Blob(['a;b\n1;2']) })))
      .rejects.toMatchObject({ status: 400, body: { error: DAILY_UPLOAD_ERRORS.invalidKind } })
  })

  it('rejects an oversized body before reading it (413) and a bad file type (415)', async () => {
    const big = new Request('http://localhost/x', {
      method: 'POST',
      body: 'x',
      headers: { 'content-type': 'multipart/form-data; boundary=abc', 'content-length': String(MAX_MULTIPART_BYTES + 1) },
    })
    await expect(readDailyUpload(big)).rejects.toMatchObject({ status: 413, body: { error: DAILY_FILE_ERRORS.tooLarge } })
    await expect(readDailyUpload(multipart({ file: new Blob(['a;b']) }, 'rpe.xls'))).rejects.toMatchObject({ status: 415 })
  })

  it('reads assignments as a JSON object of player ids or null', () => {
    const form = new FormData()
    form.set('assignments', JSON.stringify({ 'Kowalsky J.': 'id-1', Nowak: '' }))
    expect(readAssignments(form)).toEqual({ 'Kowalsky J.': 'id-1', Nowak: null })
    form.set('assignments', '[1]')
    expect(() => readAssignments(form)).toThrow()
    form.set('assignments', '{oops')
    expect(() => readAssignments(form)).toThrow()
    form.delete('assignments')
    expect(readAssignments(form)).toEqual({})
  })
})

describe('toTrainingSessionView', () => {
  const base = {
    id: 's1', playerId: 'p1', sessionDate: '2026-10-20', sessionNo: 2, kind: 'trening', previousMinutes: null, previousRpe: null,
    correctedAt: null, importId: 'i1', updatedAt: new Date('2026-10-21T08:00:00Z'),
  }

  it('computes load at read time and keeps "Brak RPE" as null, never 0', () => {
    expect(toTrainingSessionView({ ...base, minutes: 60, rpe: 7 } as unknown as AthletesTrainingSession)).toMatchObject({ load: 420, rpeMissing: false, sessionNo: 2 })
    expect(toTrainingSessionView({ ...base, minutes: 60, rpe: null } as unknown as AthletesTrainingSession)).toMatchObject({ rpe: null, load: null, rpeMissing: true })
    expect(toTrainingSessionView({ ...base, minutes: null, rpe: 7 } as unknown as AthletesTrainingSession)).toMatchObject({ load: null, rpeMissing: false })
  })
})
