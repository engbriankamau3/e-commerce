import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { CategoryWithCount, Product } from '../../../shared/src/types.ts';
import { formatMoney } from '../../../shared/src/validators.ts';
import { apiRequest } from '../lib/api.ts';
import { addItemToBag } from '../lib/store.ts';
import { SafeImage } from './SafeImage.tsx';

interface StorefrontCatalogProps {
  initialProducts: Product[];
}

export const StorefrontCatalog: React.FC<StorefrontCatalogProps> = ({ initialProducts }) => {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [managedCategories, setManagedCategories] = useState<CategoryWithCount[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantMap, setSelectedVariantMap] = useState<Record<string, string>>({});
  const [recentlyAddedKey, setRecentlyAddedKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<{ products: Product[] }>('/allproducts'),
      apiRequest<{ categories: CategoryWithCount[] }>('/api/categories').catch(() => ({
        categories: [] as CategoryWithCount[],
      })),
    ])
      .then(([prodRes, catRes]) => {
        if (Array.isArray(prodRes.products) && prodRes.products.length > 0) {
          setProducts(prodRes.products);
        }
        if (Array.isArray(catRes.categories)) {
          setManagedCategories(catRes.categories);
        }
      })
      .catch((err) => {
        setLoadError((err as Error).message);
      });
  }, []);

  const categories = useMemo(() => {
    const activeByLower = new Map<string, string>();
    for (const p of products) {
      const clean = p.category?.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (!activeByLower.has(key)) {
        activeByLower.set(key, clean);
      }
    }

    const ordered: string[] = ['All'];
    const seen = new Set<string>(['all']);

    for (const cat of managedCategories) {
      const clean = cat.name.trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      if (activeByLower.has(key) || cat.productCount > 0) {
        ordered.push(activeByLower.get(key) || clean);
        seen.add(key);
      }
    }

    for (const [key, displayName] of activeByLower.entries()) {
      if (!seen.has(key)) {
        ordered.push(displayName);
        seen.add(key);
      }
    }

    return ordered;
  }, [products, managedCategories]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const catMatch =
        activeCategory === 'All' || p.category.toLowerCase() === activeCategory.toLowerCase();
      const q = searchQuery.trim().toLowerCase();
      const textMatch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q);
      return catMatch && textMatch;
    });
  }, [products, activeCategory, searchQuery]);

  const getChosenVariant = (product: Product) => {
    const chosenSku = selectedVariantMap[product.id];
    return (
      product.variants.find((v) => v.sku === chosenSku) ||
      product.variants[0] || { sku: product.id, label: 'Standard', stock: 1 }
    );
  };

  const handleAddToBag = (product: Product, openDrawer = false) => {
    const variant = getChosenVariant(product);
    const unitPriceCents = variant.priceCents ?? product.retailPriceCents;
    addItemToBag({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      variantSku: variant.sku,
      variantLabel: variant.label,
      unitPriceCents,
      image: product.images[0] || '',
      quantity: 1,
    });
    const key = `${product.id}-${variant.sku}`;
    setRecentlyAddedKey(key);
    setTimeout(() => setRecentlyAddedKey((prev) => (prev === key ? null : prev)), 1600);
    if (openDrawer && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kora:open-bag'));
    }
  };

  return (
    <section id="collection" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-[#141413]/10">
        <div>
          <p className="text-xs font-medium tracking-wide text-[#5C5B57] mb-2">
            Curated Release · {filteredProducts.length} Objects
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[#141413]">
            Featured Collection
          </h2>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#5C5B57] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search catalog..."
              aria-label="Search catalog"
              className="w-full sm:w-56 min-h-[44px] pl-10 pr-4 text-sm bg-white border border-[#141413]/15 rounded-md text-[#141413] placeholder:text-[#5C5B57] focus:outline-none focus:border-[#1B4332]"
            />
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-[#F3F2EE] rounded-md overflow-x-auto max-w-full"
            role="tablist"
            aria-label="Filter by category"
          >
            {categories.map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(cat)}
                  className={`min-h-[44px] px-3.5 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-[#141413] shadow-xs'
                      : 'text-[#5C5B57] hover:text-[#141413]'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mt-6 p-3.5 rounded-md border border-[#141413]/15 bg-[#F3F2EE] text-xs text-[#5C5B57]">
          Showing bundled catalog preview while API reconnects ({loadError}).
        </div>
      )}

      {filteredProducts.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-[#5C5B57] mb-4">No items matched your search or category filter.</p>
          <button
            type="button"
            onClick={() => {
              setActiveCategory('All');
              setSearchQuery('');
            }}
            className="min-h-[44px] px-5 py-2.5 text-sm font-medium bg-[#141413] text-white rounded-md cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredProducts.map((product) => {
            const variant = getChosenVariant(product);
            const priceCents = variant.priceCents ?? product.retailPriceCents;
            const addedKey = `${product.id}-${variant.sku}`;
            const isAdded = recentlyAddedKey === addedKey;

            return (
              <article
                key={product.id}
                className="group flex flex-col bg-white border border-[#141413]/10 rounded-lg overflow-hidden transition-transform duration-200 hover:-translate-y-0.5"
              >
                <button
                  type="button"
                  onClick={() => setSelectedProduct(product)}
                  className="block aspect-[4/3] w-full overflow-hidden bg-[#F3F2EE] text-left cursor-pointer"
                >
                  <SafeImage
                    src={product.images[0]}
                    alt={product.name}
                    fallbackLabel={product.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                </button>

                <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-[#5C5B57] mb-1.5">
                      <span>{product.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{variant.stock > 0 ? 'In Stock' : 'Sold Out'}</span>
                    </div>

                    <div className="flex items-baseline justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(product)}
                        className="text-left text-base font-semibold text-[#141413] hover:text-[#1B4332] transition-colors cursor-pointer"
                      >
                        {product.name}
                      </button>
                      <span className="text-[15px] font-mono font-medium tabular-nums text-[#141413] shrink-0">
                        {formatMoney(priceCents, 'USD')}
                      </span>
                    </div>

                    {product.variants.length > 1 ? (
                      <div className="mt-3">
                        <label htmlFor={`var-${product.id}`} className="sr-only">
                          Select variant for {product.name}
                        </label>
                        <select
                          id={`var-${product.id}`}
                          value={variant.sku}
                          onChange={(e) =>
                            setSelectedVariantMap((prev) => ({
                              ...prev,
                              [product.id]: e.target.value,
                            }))
                          }
                          className="w-full min-h-[44px] px-3 text-xs bg-[#FAFAF8] border border-[#141413]/15 rounded-md text-[#141413]"
                        >
                          {product.variants.map((v) => (
                            <option key={v.sku} value={v.sku}>
                              {v.label} ({v.stock} left)
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-[#5C5B57]">{variant.label}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      disabled={variant.stock <= 0}
                      onClick={() => handleAddToBag(product, false)}
                      className="flex-1 min-h-[44px] px-4 py-2 text-sm font-medium rounded-md bg-[#1B4332] text-white hover:bg-[#143326] disabled:opacity-40 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isAdded ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Added</span>
                        </>
                      ) : (
                        <span>Add to Bag</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedProduct(product)}
                      className="min-h-[44px] px-4 py-2 text-sm font-medium rounded-md border border-[#141413]/15 text-[#141413] hover:bg-[#F3F2EE] transition-colors cursor-pointer"
                    >
                      Details
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141413]/50"
          role="dialog"
          aria-modal="true"
          aria-label={selectedProduct.name}
        >
          <div className="bg-[#FAFAF8] w-full max-w-3xl rounded-lg overflow-hidden border border-[#141413]/15 shadow-2xl grid grid-cols-1 md:grid-cols-2 max-h-[90vh] overflow-y-auto">
            <div className="aspect-[4/3] md:aspect-auto bg-[#F3F2EE]">
              <SafeImage
                src={selectedProduct.images[0]}
                alt={selectedProduct.name}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="p-6 flex flex-col justify-between gap-5">
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs text-[#5C5B57] mb-1">
                      {selectedProduct.category} · {selectedProduct.source === 'cj' ? 'Curated Partner Supply' : 'Atelier Release'}
                    </p>
                    <h3 className="font-display text-2xl font-semibold text-[#141413]">
                      {selectedProduct.name}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedProduct(null)}
                    aria-label="Close product details"
                    className="w-11 h-11 inline-flex items-center justify-center rounded-md hover:bg-[#F3F2EE] cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="mt-3 text-lg font-mono font-semibold tabular-nums text-[#141413]">
                  {formatMoney(
                    getChosenVariant(selectedProduct).priceCents ?? selectedProduct.retailPriceCents,
                    'USD'
                  )}
                </p>

                <p className="mt-4 text-sm leading-relaxed text-[#5C5B57]">
                  {selectedProduct.description}
                </p>

                <div className="mt-5">
                  <label className="block text-xs font-medium text-[#141413] mb-2">
                    Select Variant
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {selectedProduct.variants.map((v) => {
                      const active = getChosenVariant(selectedProduct).sku === v.sku;
                      return (
                        <button
                          key={v.sku}
                          type="button"
                          onClick={() =>
                            setSelectedVariantMap((prev) => ({
                              ...prev,
                              [selectedProduct.id]: v.sku,
                            }))
                          }
                          className={`min-h-[44px] px-3.5 py-2 text-left text-xs rounded-md border flex items-center justify-between cursor-pointer ${
                            active
                              ? 'border-[#1B4332] bg-[#1B4332]/5 text-[#141413] font-semibold'
                              : 'border-[#141413]/15 bg-white text-[#5C5B57]'
                          }`}
                        >
                          <span>{v.label}</span>
                          <span className="font-mono tabular-nums">{v.stock} available</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    handleAddToBag(selectedProduct, true);
                    setSelectedProduct(null);
                  }}
                  className="flex-1 min-h-[44px] px-5 py-3 text-sm font-semibold bg-[#1B4332] text-white rounded-md hover:bg-[#143326] transition-colors cursor-pointer"
                >
                  Add &amp; Open Bag
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
