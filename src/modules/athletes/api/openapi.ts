import { z, type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const athletesTag = 'Athletes'

export const athletesErrorSchema = z.object({ error: z.string() }).passthrough()
export const athletesOkSchema = z.object({ ok: z.literal(true) })
export const athletesCreatedSchema = z.object({ id: z.string().uuid() })
export const athletesDeleteSchema = z.object({ id: z.string().uuid() })

export const optionsResponseSchema = z.object({
  items: z.array(z.object({ value: z.string(), label: z.string() })),
})

export function createAthletesPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildAthletesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: athletesTag,
  defaultCreateResponseSchema: athletesCreatedSchema,
  defaultOkResponseSchema: athletesOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns ${pluralLower} of the caller's club (tenant and organization from the authenticated context).`,
})

export function createAthletesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildAthletesCrudOpenApi(options)
}

export function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}
