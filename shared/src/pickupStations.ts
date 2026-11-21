import type { PickupStation } from './types.ts';

export const PICKUP_STATIONS: PickupStation[] = [
  {
    id: 'nbo-cbd-hub',
    name: 'Kora Nairobi CBD Locker',
    area: 'Kimathi Street, Nairobi',
    hours: 'Mon-Sat 08:00-19:00',
    shippingCents: 0,
  },
  {
    id: 'nbo-westlands',
    name: 'Westlands Sarit Pickup Desk',
    area: 'Westlands, Nairobi',
    hours: 'Mon-Sun 09:00-20:00',
    shippingCents: 0,
  },
  {
    id: 'nbo-kilimani',
    name: 'Kilimani Studio Collection Point',
    area: 'Yaya / Argwings Kodhek, Nairobi',
    hours: 'Mon-Sat 09:00-18:00',
    shippingCents: 0,
  },
  {
    id: 'mba-nyali',
    name: 'Mombasa Nyali Partner Depot',
    area: 'Links Road, Mombasa',
    hours: 'Mon-Sat 08:30-17:30',
    shippingCents: 600,
  },
  {
    id: 'custom-courier',
    name: 'Direct Area Dispatch (Store-Managed)',
    area: 'Custom Street or Estate Area',
    hours: 'Scheduled 24-72h window',
    shippingCents: 1200,
  },
];

export function findPickupStation(stationId: string): PickupStation | undefined {
  return PICKUP_STATIONS.find((station) => station.id === stationId);
}
