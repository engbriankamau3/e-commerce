import type { CjCatalogItem, Product } from '../../../shared/src/types.ts';

const CJ_PREVIEW_SUPPLIER_CATALOG: CjCatalogItem[] = [
  {
    cjProductId: 'CJ-2026-8841',
    name: 'Anodized Aluminum Pocket Pen',
    category: 'Workspace',
    description:
      'CNC-machined aerospace aluminum rollerball pen with matte bead-blasted finish and brass clip.',
    image: '/src/assets/images/prod_leather_folio_1795286029972.jpg',
    supplierCostCents: 1450,
    suggestedRetailCents: 4200,
    variants: [
      {
        cjVariantId: 'CJV-8841-BLK',
        sku: 'CJ-PEN-BLK',
        label: 'Matte Black / 0.5mm',
        stock: 64,
        supplierCostCents: 1450,
      },
      {
        cjVariantId: 'CJV-8841-RAW',
        sku: 'CJ-PEN-RAW',
        label: 'Raw Aluminum / 0.5mm',
        stock: 38,
        supplierCostCents: 1550,
      },
    ],
  },
  {
    cjProductId: 'CJ-2026-9102',
    name: 'Double-Wall Vacuum Travel Flask',
    category: 'Objects',
    description:
      '18/8 stainless steel insulated flask with powder-coated finish and leak-proof machined steel cap.',
    image: '/src/assets/images/prod_ceramic_carafe_1795286029988.jpg',
    supplierCostCents: 1620,
    suggestedRetailCents: 4800,
    variants: [
      {
        cjVariantId: 'CJV-9102-FOR',
        sku: 'CJ-FLK-500-FOR',
        label: 'Forest Matte / 500ml',
        stock: 42,
        supplierCostCents: 1620,
      },
      {
        cjVariantId: 'CJV-9102-STO',
        sku: 'CJ-FLK-500-STO',
        label: 'Warm Stone / 500ml',
        stock: 29,
        supplierCostCents: 1620,
      },
    ],
  },
  {
    cjProductId: 'CJ-2026-9450',
    name: 'Ripstop Modular Commuter Sling',
    category: 'Carry',
    description:
      'Weather-resistant 420D ripstop nylon crossbody sling with magnetic Fidlock buckle and weatherproof zip.',
    image: '/src/assets/images/prod_canvas_tote_1795286029892.jpg',
    supplierCostCents: 2480,
    suggestedRetailCents: 7400,
    variants: [
      {
        cjVariantId: 'CJV-9450-OBS',
        sku: 'CJ-SLG-OBS',
        label: 'Obsidian / 4L',
        stock: 25,
        supplierCostCents: 2480,
      },
    ],
  },
];

export interface CjSearchResult {
  items: CjCatalogItem[];
  sourceMode: 'live' | 'preview';
}

export async function searchCjCatalog(query: string, cjApiKey: string): Promise<CjSearchResult> {
  const q = query.trim().toLowerCase();

  if (!cjApiKey) {
    const filtered = q
      ? CJ_PREVIEW_SUPPLIER_CATALOG.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q) ||
            item.cjProductId.toLowerCase().includes(q)
        )
      : CJ_PREVIEW_SUPPLIER_CATALOG;
    return { items: filtered, sourceMode: 'preview' };
  }

  const url = new URL('https://developers.cjdropshipping.com/api2.0/v1/product/list');
  if (q) url.searchParams.set('productNameEn', q);
  url.searchParams.set('pageNum', '1');
  url.searchParams.set('pageSize', '12');

  const resp = await fetch(url.toString(), {
    headers: {
      'CJ-Access-Token': cjApiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    throw new Error(`CJ Dropshipping API error (${resp.status})`);
  }

  const body = (await resp.json()) as {
    result?: boolean;
    message?: string;
    data?: {
      list?: Array<{
        pid: string;
        productNameEn: string;
        categoryName?: string;
        productImage?: string;
        sellPrice?: string | number;
      }>;
    };
  };

  if (!body.result || !body.data?.list) {
    throw new Error(body.message || 'Unexpected response from CJ Dropshipping API');
  }

  const mapped: CjCatalogItem[] = body.data.list.map((row) => {
    const costDollars = Number(row.sellPrice || 15);
    const supplierCostCents = Math.max(100, Math.round(costDollars * 100));
    return {
      cjProductId: row.pid,
      name: row.productNameEn,
      category: row.categoryName || 'Imported',
      description: `Imported supplier item (${row.pid}). Pricing and fulfillment reviewed manually by Kora & Co.`,
      image: row.productImage || '/src/assets/images/prod_canvas_tote_1795286029892.jpg',
      supplierCostCents,
      suggestedRetailCents: Math.round(supplierCostCents * 2.4),
      variants: [
        {
          cjVariantId: `${row.pid}-STD`,
          sku: `CJ-${row.pid.slice(-6)}`,
          label: 'Standard',
          stock: 20,
          supplierCostCents,
        },
      ],
    };
  });

  return { items: mapped, sourceMode: 'live' };
}

export async function getCjCatalogItemById(
  cjProductId: string,
  cjApiKey: string
): Promise<CjCatalogItem | null> {
  const localMatch = CJ_PREVIEW_SUPPLIER_CATALOG.find((item) => item.cjProductId === cjProductId);
  if (localMatch && !cjApiKey) return localMatch;

  if (!cjApiKey) return localMatch || null;

  const url = new URL('https://developers.cjdropshipping.com/api2.0/v1/product/query');
  url.searchParams.set('pid', cjProductId);
  const resp = await fetch(url.toString(), {
    headers: {
      'CJ-Access-Token': cjApiKey,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) {
    return localMatch || null;
  }
  const body = (await resp.json()) as {
    result?: boolean;
    data?: {
      pid: string;
      productNameEn: string;
      categoryName?: string;
      description?: string;
      productImage?: string;
      sellPrice?: string | number;
      variants?: Array<{
        vid: string;
        variantSku: string;
        variantNameEn?: string;
        variantSellPrice?: string | number;
      }>;
    };
  };
  if (!body.result || !body.data) return localMatch || null;

  const d = body.data;
  const baseCost = Math.max(100, Math.round(Number(d.sellPrice || 15) * 100));
  const variants =
    Array.isArray(d.variants) && d.variants.length > 0
      ? d.variants.map((v) => ({
          cjVariantId: v.vid,
          sku: v.variantSku || `CJ-${v.vid.slice(-6)}`,
          label: v.variantNameEn || 'Standard',
          stock: 20,
          supplierCostCents: Math.max(100, Math.round(Number(v.variantSellPrice || d.sellPrice || 15) * 100)),
        }))
      : [
          {
            cjVariantId: `${d.pid}-STD`,
            sku: `CJ-${d.pid.slice(-6)}`,
            label: 'Standard',
            stock: 20,
            supplierCostCents: baseCost,
          },
        ];

  return {
    cjProductId: d.pid,
    name: d.productNameEn,
    category: d.categoryName || 'Imported',
    description: d.description || 'CJ Dropshipping catalog item',
    image: d.productImage || '/src/assets/images/prod_canvas_tote_1795286029892.jpg',
    supplierCostCents: baseCost,
    suggestedRetailCents: Math.round(baseCost * 2.4),
    variants,
  };
}

export interface CjRecheckOutcome {
  available: boolean;
  latestSupplierCostCents?: number;
  reason?: string;
}

/**
 * Rechecks CJ Dropshipping variant availability and cost snapshot server-side prior to checkout.
 * Never places an automatic supplier order.
 */
export async function recheckCjVariantBeforeCheckout(
  product: Product,
  variantSku: string,
  quantity: number,
  cjApiKey: string
): Promise<CjRecheckOutcome> {
  if (product.source !== 'cj') {
    return { available: true };
  }

  const variant = product.variants.find((v) => v.sku === variantSku);
  if (!variant) {
    return { available: false, reason: `Variant ${variantSku} not found` };
  }
  if (variant.stock < quantity) {
    return { available: false, reason: `Insufficient stock for ${product.name} (${variant.label})` };
  }

  if (!cjApiKey || !variant.cjVariantId) {
    return {
      available: true,
      latestSupplierCostCents: variant.supplierCostCents ?? product.supplierCostCents,
    };
  }

  try {
    const url = new URL('https://developers.cjdropshipping.com/api2.0/v1/product/variant/queryByVid');
    url.searchParams.set('vid', variant.cjVariantId);
    const resp = await fetch(url.toString(), {
      headers: { 'CJ-Access-Token': cjApiKey },
    });
    if (!resp.ok) {
      return {
        available: true,
        latestSupplierCostCents: variant.supplierCostCents ?? product.supplierCostCents,
      };
    }
    const data = (await resp.json()) as {
      result?: boolean;
      data?: { variantSellPrice?: string | number };
    };
    const latestCost = data.data?.variantSellPrice
      ? Math.round(Number(data.data.variantSellPrice) * 100)
      : variant.supplierCostCents ?? product.supplierCostCents;
    return { available: true, latestSupplierCostCents: latestCost };
  } catch {
    return {
      available: true,
      latestSupplierCostCents: variant.supplierCostCents ?? product.supplierCostCents,
    };
  }
}
