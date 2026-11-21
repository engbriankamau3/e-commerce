import type { Product } from './types.ts';

export const HERO_IMAGE_PATH = '/src/assets/images/hero_kora_atelier_1795286030549.jpg';

export const SAMPLE_PRODUCTS: Product[] = [
  {
    id: 'prod-waxed-tote',
    slug: 'field-waxed-canvas-tote',
    name: 'Field Waxed Canvas Tote',
    category: 'Carry',
    description:
      'Constructed from 18oz dry-waxed cotton duck with full-grain vegetable-tanned bridle handles, solid brass rivets, and a padded 16-inch sleeve.',
    images: ['/src/assets/images/prod_canvas_tote_1795286029892.jpg'],
    currency: 'USD',
    retailPriceCents: 14500,
    variants: [
      { sku: 'KRA-TOTE-OLV', label: 'Olive / Saddle', stock: 18 },
      { sku: 'KRA-TOTE-OBS', label: 'Obsidian / Espresso', stock: 12 },
    ],
    source: 'manual',
    active: true,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  },
  {
    id: 'prod-stoneware-carafe',
    slug: 'kinto-stoneware-pourover-set',
    name: 'Kiln Stoneware Pour-Over Set',
    category: 'Objects',
    description:
      'Wheel-thrown matte chalk stoneware dripper, matching server carafe, and handleless tasting vessel fired for clean thermal retention.',
    images: ['/src/assets/images/prod_ceramic_carafe_1795286029988.jpg'],
    currency: 'USD',
    retailPriceCents: 7800,
    variants: [
      { sku: 'KRA-CER-CHK', label: 'Chalk Matte (500ml)', stock: 24 },
      { sku: 'KRA-CER-ASH', label: 'Raw Ash (500ml)', stock: 9 },
    ],
    source: 'manual',
    active: true,
    createdAt: '2026-10-02T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
  },
  {
    id: 'prod-merino-overshirt',
    slug: 'heavyweight-merino-overshirt',
    name: 'Heavyweight Merino Overshirt',
    category: 'Apparel',
    description:
      'Double-faced 420gsm Australian merino wool twill cut with gusseted chest pockets, horn buttons, and an unlined architectural drape.',
    images: ['/src/assets/images/prod_merino_overshirt_1795286030472.jpg'],
    currency: 'USD',
    retailPriceCents: 21000,
    variants: [
      { sku: 'KRA-OVR-CHR-M', label: 'Charcoal / M', stock: 11 },
      { sku: 'KRA-OVR-CHR-L', label: 'Charcoal / L', stock: 14 },
      { sku: 'KRA-OVR-CHR-XL', label: 'Charcoal / XL', stock: 6 },
    ],
    source: 'manual',
    active: true,
    createdAt: '2026-10-03T08:00:00.000Z',
    updatedAt: '2026-10-03T08:00:00.000Z',
  },
  {
    id: 'prod-titanium-watch',
    slug: 'meridian-titanium-field-watch',
    name: 'Meridian Titanium Field Watch',
    category: 'Timepieces',
    description:
      'Grade-2 bead-blasted titanium 38mm case with sapphire crystal, high-contrast luminous Arabic numerals, and woven Cordura field strap.',
    images: ['/src/assets/images/prod_titanium_watch_1795286029771.jpg'],
    currency: 'USD',
    retailPriceCents: 32500,
    variants: [
      { sku: 'KRA-WCH-FOR', label: '38mm / Forest Nylon', stock: 7 },
      { sku: 'KRA-WCH-SLT', label: '38mm / Slate Nylon', stock: 5 },
    ],
    source: 'manual',
    active: true,
    createdAt: '2026-10-04T08:00:00.000Z',
    updatedAt: '2026-10-04T08:00:00.000Z',
  },
  {
    id: 'prod-atelier-lamp',
    slug: 'cantilever-brass-task-lamp',
    name: 'Cantilever Brass Task Lamp',
    category: 'Workspace',
    description:
      'Precision-machined brushed brass arm paired with an anodized matte obsidian shade and warm 2700K stepless dimming LED array.',
    images: ['/src/assets/images/prod_desk_lamp_1795286030477.jpg'],
    currency: 'USD',
    retailPriceCents: 18800,
    variants: [
      { sku: 'KRA-LMP-BRS', label: 'Brushed Brass / Obsidian', stock: 10 },
    ],
    source: 'manual',
    active: true,
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
  },
  {
    id: 'prod-leather-folio',
    slug: 'bridle-leather-tech-folio',
    name: 'Bridle Leather Tech Folio',
    category: 'Carry',
    description:
      'Full-grain Tuscan espresso leather organizer with YKK Excella brass zip, woven cable loops, and microsuede-lined 14-inch compartment.',
    images: ['/src/assets/images/prod_leather_folio_1795286029972.jpg'],
    currency: 'USD',
    retailPriceCents: 11800,
    variants: [
      { sku: 'KRA-FOL-14', label: 'Espresso / 14-inch', stock: 15 },
      { sku: 'KRA-FOL-CMP', label: 'Espresso / Compact Tech', stock: 22 },
    ],
    source: 'manual',
    active: true,
    createdAt: '2026-10-06T08:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
  },
];
