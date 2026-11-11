import { z } from 'zod';

export const venueLayoutSchema = z.object({
  name: z.string().min(1),
  mapData: z.object({
    sections: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        color: z.string(),
        seats: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            x: z.number(),
            y: z.number(),
            row: z.string().optional(),
            tier: z.string().optional(),
          })
        ),
      })
    ),
  }),
});

export type VenueLayoutInput = z.infer<typeof venueLayoutSchema>;
