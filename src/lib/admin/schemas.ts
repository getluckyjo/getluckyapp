/**
 * Zod schemas shared between admin route files. Route modules may only export
 * HTTP handlers, so anything two routes share lives here.
 */
import { z } from 'zod'

/** Editable course columns, no defaults: the PATCH schema is this made partial. */
export const CourseFieldsBase = z.object({
  name: z.string().trim().min(1).max(120),
  location_text: z.string().trim().max(200).nullable(),
  region: z.string().trim().max(100).nullable(),
  country: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  image_url: z.url().max(500).nullable(),
  is_partner: z.boolean(),
})

/** Creation: name required, the rest optional with sensible defaults. */
export const CourseFields = CourseFieldsBase.partial().extend({
  name: CourseFieldsBase.shape.name,
  country: CourseFieldsBase.shape.country.default('South Africa'),
  is_partner: CourseFieldsBase.shape.is_partner.default(false),
})

/** Editable hole columns, no defaults: the PATCH schema is this made partial. */
export const HoleFieldsBase = z.object({
  hole_number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(5),
  distance_metres: z.number().int().min(30).max(400).nullable(),
  is_active: z.boolean(),
  jackpot_amount: z.number().int().min(0),
})

export const HoleFields = HoleFieldsBase.partial().extend({
  hole_number: HoleFieldsBase.shape.hole_number,
  par: HoleFieldsBase.shape.par.default(3),
  is_active: HoleFieldsBase.shape.is_active.default(true),
  jackpot_amount: HoleFieldsBase.shape.jackpot_amount.default(0),
})

