import React, { useEffect, useState } from 'react';
import {
  Boxes,
  Globe,
  KeyRound,
  LogOut,
  Package,
  Pencil,
  Plus,
  Receipt,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  CategoryWithCount,
  CjCatalogItem,
  FulfillmentStatus,
  OrderRecord,
  Product,
} from '../../shared/src/types.ts';
import { formatMoney } from '../../shared/src/validators.ts';
import CategorySelector from './components/CategorySelector.tsx';
import DateRangePicker, {
  type DateRange,
  isOrderCreatedWithinRange,
} from './components/DateRangePicker.tsx';

type WorkspaceTab = 'products' | 'cj' | 'orders' | 'diagnostics';

interface DiagnosticEntry {
  name: string;
  status: 'WORKING' | 'CONFIGURED' | 'UNCONFIGURED' | 'MISCONFIGURED' | 'INVALID' | 'BLOCKED';
  detail: string;
}

interface DarajaSandboxCheckResult {
  endpoint: string;
  mpesaEnvConfigured: 'sandbox' | 'production';
  status: 'WORKING' | 'CONFIGURED' | 'UNCONFIGURED' | 'MISCONFIGURED' | 'INVALID' | 'BLOCKED';
  oauthAuthorized: boolean;
  stkAuthorized: boolean;
  oauthHttpStatus?: number;
  stkHttpStatus?: number;
  darajaCode?: string;
  detail: string;
}

function getApiBase(): string {
  const configured = (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_API_BASE_URL;
  return configured ? configured.replace(/\/+$/, '') : '';
}

async function adminFetch<T>(
  path: string,
  token: string | null,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const resp = await fetch(`${getApiBase()}${path}`, { ...options, headers });
  const text = await resp.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { error: text || 'Invalid server response' };
  }
  if (!resp.ok) {
    throw new Error(
      typeof json.error === 'string' && json.error
        ? json.error
        : `Request failed (${resp.status})`
    );
  }
  return json as T;
}

export default function AdminApp() {
  // Admin JWT held strictly in React state/memory (never localStorage/sessionStorage)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [setupStatus, setSetupStatus] = useState<{
    configuredViaEnv: boolean;
    claimed: boolean;
    needsFirstRunSetup: boolean;
  } | null>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [renameCategoryDraft, setRenameCategoryDraft] = useState('');
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [orderFilter, setOrderFilter] = useState<'PAID' | 'ALL'>('PAID');
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderDateRange, setOrderDateRange] = useState<DateRange>({ from: '', to: '' });
  const [selectedOrderRefs, setSelectedOrderRefs] = useState<string[]>([]);
  const [bulkFulfillmentStatus, setBulkFulfillmentStatus] =
    useState<FulfillmentStatus>('READY_FOR_PICKUP');
  const [cjItems, setCjItems] = useState<CjCatalogItem[]>([]);
  const [cjSourceMode, setCjSourceMode] = useState<'live' | 'preview'>('preview');
  const [cjQuery, setCjQuery] = useState('');
  const [reviewingCjItem, setReviewingCjItem] = useState<CjCatalogItem | null>(null);
  const [cjImportName, setCjImportName] = useState('');
  const [cjImportCategory, setCjImportCategory] = useState('Carry');
  const [cjImportDescription, setCjImportDescription] = useState('');
  const [cjImportRetailUsd, setCjImportRetailUsd] = useState('');
  const [cjImportVariantStocks, setCjImportVariantStocks] = useState<Record<string, string>>({});
  const [diagnosticsDbMode, setDiagnosticsDbMode] = useState<'mongodb' | 'local' | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [diagLoading, setDiagLoading] = useState(false);
  const [darajaSandboxResult, setDarajaSandboxResult] = useState<DarajaSandboxCheckResult | null>(null);
  const [darajaLoading, setDarajaLoading] = useState(false);

  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create Product Form
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Carry');
  const [newDescription, setNewDescription] = useState('');
  const [newPriceUsd, setNewPriceUsd] = useState('85.00');
  const [newVariants, setNewVariants] = useState<Array<{ sku: string; label: string; stock: string }>>([
    { sku: 'KRA-NEW-01', label: 'Standard', stock: '15' },
  ]);
  const [newImageUrl, setNewImageUrl] = useState('/src/assets/images/prod_canvas_tote_1795286029892.jpg');

  // Edit Product Modal
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editCategory, setEditCategory] = useState('Carry');
  const [editPriceUsd, setEditPriceUsd] = useState('');
  const [editVariantStocks, setEditVariantStocks] = useState<Record<string, string>>({});

  useEffect(() => {
    adminFetch<{
      configuredViaEnv: boolean;
      claimed: boolean;
      needsFirstRunSetup: boolean;
    }>('/api/admin/setup-status', null)
      .then((res) => setSetupStatus(res))
      .catch(() => {});
  }, []);

  const loadWorkspaceData = async (token: string, filter: 'PAID' | 'ALL' = orderFilter) => {
    setActionError(null);
    try {
      const ordPath = filter === 'PAID' ? '/admin/orders/paid' : '/admin/orders';
      const [prodRes, catRes, ordRes] = await Promise.all([
        adminFetch<{ products: Product[] }>('/allproducts', token),
        adminFetch<{ categories: CategoryWithCount[] }>('/api/admin/categories', token),
        adminFetch<{ orders: OrderRecord[] }>(ordPath, token),
      ]);
      setProducts(prodRes.products || []);
      setCategories(catRes.categories || []);
      const nextOrders = ordRes.orders || [];
      setOrders(nextOrders);
      const validSet = new Set(nextOrders.map((o) => o.orderReference));
      setSelectedOrderRefs((prev) => prev.filter((ref) => validSet.has(ref)));
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const handleAdminAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const endpoint = setupStatus?.needsFirstRunSetup ? '/api/admin/setup' : '/api/admin/login';
      const res = await adminFetch<{ token: string; admin: { email: string } }>(endpoint, null, {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      setAdminToken(res.token);
      setAdminEmail(res.admin.email);
      setLoginPassword('');
      await loadWorkspaceData(res.token);
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !adminToken) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await adminFetch<{ imageUrl: string }>('/upload', adminToken, {
        method: 'POST',
        body: form,
      });
      setNewImageUrl(res.imageUrl);
      setActionNotice(`Uploaded image: ${res.imageUrl}`);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCategory = async (name: string): Promise<string> => {
    if (!adminToken) {
      throw new Error('Admin session expired');
    }
    const res = await adminFetch<{ category: CategoryWithCount }>('/api/admin/categories', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await loadWorkspaceData(adminToken);
    setActionNotice(`Category "${res.category.name}" added to directory.`);
    return res.category.name;
  };

  const handleAddCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    const trimmed = newCategoryName.trim();
    if (trimmed.length < 2) {
      setActionError('Category name must be at least 2 characters.');
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await handleCreateCategory(trimmed);
      setNewCategoryName('');
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRenameCategory = async (id: string) => {
    if (!adminToken) return;
    const trimmed = renameCategoryDraft.trim();
    if (trimmed.length < 2) {
      setActionError('Category name must be at least 2 characters.');
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await adminFetch<{ category: CategoryWithCount; updatedProductCount: number }>(
        `/api/admin/categories/${encodeURIComponent(id)}`,
        adminToken,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: trimmed }),
        }
      );
      setRenamingCategoryId(null);
      setRenameCategoryDraft('');
      setActionNotice(
        `Renamed category to "${res.category.name}" (${res.updatedProductCount} product(s) updated).`
      );
      await loadWorkspaceData(adminToken);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCategory = async (cat: CategoryWithCount) => {
    if (!adminToken) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await adminFetch(`/api/admin/categories/${encodeURIComponent(cat.id)}`, adminToken, {
        method: 'DELETE',
      });
      setActionNotice(`Deleted empty category "${cat.name}".`);
      await loadWorkspaceData(adminToken);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const cents = Math.round(Number(newPriceUsd) * 100);
      if (!Number.isFinite(cents) || cents < 100) {
        throw new Error('Enter a valid retail price of at least $1.00');
      }
      if (newVariants.length === 0) {
        throw new Error('Add at least one variant SKU');
      }
      const parsedVariants = newVariants.map((v, idx) => {
        const sku = v.sku.trim();
        const label = v.label.trim();
        const stock = Math.floor(Number(v.stock));
        if (sku.length < 2) {
          throw new Error(`Variant row ${idx + 1} requires a SKU of at least 2 characters`);
        }
        if (!label) {
          throw new Error(`Variant row ${idx + 1} requires a label`);
        }
        if (!Number.isFinite(stock) || stock < 0) {
          throw new Error(`Variant ${sku} stock must be 0 or higher`);
        }
        return { sku, label, stock };
      });

      await adminFetch('/addproduct', adminToken, {
        method: 'POST',
        body: JSON.stringify({
          name: newName,
          category: newCategory,
          description: newDescription,
          images: [newImageUrl],
          retailPriceCents: cents,
          variants: parsedVariants,
        }),
      });
      setNewName('');
      setNewDescription('');
      setNewVariants([{ sku: `KRA-NEW-${String(products.length + 1).padStart(2, '0')}`, label: 'Standard', stock: '15' }]);
      setActionNotice('Product added to catalog.');
      await loadWorkspaceData(adminToken);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveProduct = async (id: string) => {
    if (!adminToken) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminFetch('/removeproduct', adminToken, {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      setActionNotice('Product removed from storefront catalog.');
      await loadWorkspaceData(adminToken);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openEditModal = (product: Product) => {
    setActionError(null);
    setActionNotice(null);
    setEditingProduct(product);
    setEditCategory(product.category);
    setEditPriceUsd((product.retailPriceCents / 100).toFixed(2));
    const stocks: Record<string, string> = {};
    for (const v of product.variants) {
      stocks[v.sku] = String(v.stock);
    }
    setEditVariantStocks(stocks);
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !editingProduct) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const retailPriceCents = Math.round(Number(editPriceUsd) * 100);
      if (!Number.isFinite(retailPriceCents) || retailPriceCents < 100) {
        throw new Error('Enter a valid retail price of at least $1.00');
      }

      const variants = editingProduct.variants.map((v) => {
        const raw = editVariantStocks[v.sku] ?? String(v.stock);
        const parsedStock = Math.floor(Number(raw));
        if (!Number.isFinite(parsedStock) || parsedStock < 0) {
          throw new Error(`Enter a valid stock level (0 or higher) for ${v.sku}`);
        }
        return { sku: v.sku, stock: parsedStock };
      });

      await adminFetch(`/api/admin/products/${encodeURIComponent(editingProduct.id)}`, adminToken, {
        method: 'PATCH',
        body: JSON.stringify({
          category: editCategory,
          retailPriceCents,
          variants,
        }),
      });

      const updatedName = editingProduct.name;
      setEditingProduct(null);
      setActionNotice(`Updated category, price, and stock for ${updatedName}.`);
      await loadWorkspaceData(adminToken);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSearchCj = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!adminToken) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await adminFetch<{ items: CjCatalogItem[]; sourceMode: 'live' | 'preview' }>(
        `/admin/cj/products?q=${encodeURIComponent(cjQuery)}`,
        adminToken
      );
      setCjItems(res.items || []);
      setCjSourceMode(res.sourceMode);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openCjReviewModal = (cjItem: CjCatalogItem) => {
    setActionError(null);
    setActionNotice(null);
    setReviewingCjItem(cjItem);
    setCjImportName(cjItem.name);
    setCjImportCategory(cjItem.category);
    setCjImportDescription(cjItem.description);
    setCjImportRetailUsd((cjItem.suggestedRetailCents / 100).toFixed(2));
    const stocks: Record<string, string> = {};
    for (const v of cjItem.variants) {
      stocks[v.sku] = String(v.stock);
    }
    setCjImportVariantStocks(stocks);
  };

  const handleConfirmCjImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !reviewingCjItem) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const retailPriceCents = Math.round(Number(cjImportRetailUsd) * 100);
      if (!Number.isFinite(retailPriceCents) || retailPriceCents < 100) {
        throw new Error('Explicit retail price (USD) of at least $1.00 is required');
      }
      const trimmedName = cjImportName.trim();
      const trimmedCategory = cjImportCategory.trim();
      const trimmedDescription = cjImportDescription.trim();
      if (trimmedName.length < 2) {
        throw new Error('Storefront title must be at least 2 characters');
      }
      if (trimmedCategory.length < 2) {
        throw new Error('Select or create a valid category');
      }
      if (trimmedDescription.length < 5) {
        throw new Error('Description must be at least 5 characters');
      }

      const variantStocks: Record<string, number> = {};
      for (const v of reviewingCjItem.variants) {
        const raw = cjImportVariantStocks[v.sku] ?? String(v.stock);
        const parsedStock = Math.floor(Number(raw));
        if (!Number.isFinite(parsedStock) || parsedStock < 0) {
          throw new Error(`Initial stock for ${v.sku} must be 0 or higher`);
        }
        variantStocks[v.sku] = parsedStock;
      }

      const res = await adminFetch<{ policyNotice: string }>('/admin/cj/import', adminToken, {
        method: 'POST',
        body: JSON.stringify({
          cjProductId: reviewingCjItem.cjProductId,
          retailPriceCents,
          name: trimmedName,
          category: trimmedCategory,
          description: trimmedDescription,
          variantStocks,
        }),
      });
      setReviewingCjItem(null);
      setActionNotice(`Published "${trimmedName}" under ${trimmedCategory}. ${res.policyNotice}`);
      await loadWorkspaceData(adminToken);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleOrderStatusChange = async (orderReference: string, status: FulfillmentStatus) => {
    if (!adminToken) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await adminFetch(`/admin/orders/${encodeURIComponent(orderReference)}/status`, adminToken, {
        method: 'PATCH',
        body: JSON.stringify({ fulfillmentStatus: status }),
      });
      setActionNotice(`Updated ${orderReference} to ${status.replace(/_/g, ' ')}.`);
      await loadWorkspaceData(adminToken);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkOrderStatusChange = async () => {
    if (!adminToken || selectedOrderRefs.length === 0) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await adminFetch<{
        updatedCount: number;
        skipped?: Array<{ orderReference: string; reason: string }>;
      }>('/admin/orders/bulk-status', adminToken, {
        method: 'PATCH',
        body: JSON.stringify({
          orderReferences: selectedOrderRefs,
          fulfillmentStatus: bulkFulfillmentStatus,
        }),
      });
      const label = bulkFulfillmentStatus.replace(/_/g, ' ');
      const skippedNote =
        res.skipped && res.skipped.length > 0
          ? ` (${res.skipped.length} skipped: ${res.skipped[0].reason})`
          : '';
      setActionNotice(`Updated ${res.updatedCount} order(s) to ${label}.${skippedNote}`);
      setSelectedOrderRefs([]);
      await loadWorkspaceData(adminToken);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRunDiagnostics = async (tokenOverride?: string) => {
    const token = tokenOverride ?? adminToken;
    if (!token) return;
    setDiagLoading(true);
    setActionError(null);
    try {
      const [res, darajaRes] = await Promise.all([
        adminFetch<{ dbMode: 'mongodb' | 'local'; entries: DiagnosticEntry[] }>(
          '/admin/diagnostics',
          token
        ),
        adminFetch<DarajaSandboxCheckResult>('/admin/diagnostics/daraja-sandbox', token, {
          method: 'POST',
        }),
      ]);
      setDiagnosticsDbMode(res.dbMode);
      setDiagnostics(res.entries || []);
      setDarajaSandboxResult(darajaRes);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setDiagLoading(false);
    }
  };

  const handleRunDarajaSandboxCheck = async () => {
    if (!adminToken) return;
    setDarajaLoading(true);
    setActionError(null);
    try {
      const res = await adminFetch<DarajaSandboxCheckResult>(
        '/admin/diagnostics/daraja-sandbox',
        adminToken,
        { method: 'POST' }
      );
      setDarajaSandboxResult(res);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setDarajaLoading(false);
    }
  };

  if (!adminToken) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#F8FAFC]">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-6 sm:p-8 space-y-6">
          <div>
            <p className="text-xs font-medium text-slate-500">Kora &amp; Co. Operations</p>
            <h1 className="text-2xl font-semibold text-slate-900 mt-1">
              {setupStatus?.needsFirstRunSetup ? 'Claim Admin Console' : 'Admin Sign In'}
            </h1>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              {setupStatus?.needsFirstRunSetup
                ? 'ADMIN_EMAIL and ADMIN_PASSWORD are not set in environment variables. Claim this preview admin account once with a strong password.'
                : 'Authenticate with your configured administrator credentials to manage products, CJ imports, and verified paid orders.'}
            </p>
          </div>

          <form onSubmit={handleAdminAuth} className="space-y-4">
            <div>
              <label htmlFor="adm-email" className="block text-xs font-medium text-slate-700 mb-1">
                Admin Email
              </label>
              <input
                id="adm-email"
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin@kora.local"
                className="w-full min-h-[44px] px-3.5 text-sm border border-slate-200 rounded-md bg-slate-50"
              />
            </div>

            <div>
              <label htmlFor="adm-pass" className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                id="adm-pass"
                type="password"
                required
                minLength={setupStatus?.needsFirstRunSetup ? 8 : 1}
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full min-h-[44px] px-3.5 text-sm border border-slate-200 rounded-md bg-slate-50"
              />
            </div>

            {authError && (
              <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700" role="alert">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
            >
              {authLoading
                ? 'Authenticating...'
                : setupStatus?.needsFirstRunSetup
                  ? 'Claim Admin Access'
                  : 'Sign In to Admin'}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
            <a href="/" className="hover:text-slate-900 underline">
              Return to Storefront
            </a>
            <span>JWT Memory Session</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F8FAFC]">
      {/* Fixed Left Sidebar */}
      <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-slate-200 p-4 flex flex-col justify-between shrink-0">
        <div>
          <div className="px-2 py-2 mb-4 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-900">Kora &amp; Co. Admin</p>
            <p className="text-xs text-slate-500 truncate mt-0.5">{adminEmail}</p>
          </div>

          <nav className="flex md:flex-col gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('products')}
              className={`min-h-[44px] px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'products'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Boxes className="w-4 h-4" />
              <span>Catalog ({products.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('cj');
                if (cjItems.length === 0) handleSearchCj();
              }}
              className={`min-h-[44px] px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'cj'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>CJ Dropshipping</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`min-h-[44px] px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'orders'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Receipt className="w-4 h-4" />
              <span>Paid Orders ({orders.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('diagnostics');
                if (diagnostics.length === 0) handleRunDiagnostics();
              }}
              className={`min-h-[44px] px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'diagnostics'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>Key Diagnostics</span>
            </button>
          </nav>
        </div>

        <div className="hidden md:flex flex-col gap-2 pt-4 border-t border-slate-100">
          <a
            href="/"
            className="min-h-[44px] px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center"
          >
            View Live Storefront
          </a>
          <button
            type="button"
            onClick={() => {
              setAdminToken(null);
              setAdminEmail('');
            }}
            className="min-h-[44px] px-3 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-8 max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <p className="text-xs text-slate-500">Operations / {activeTab.toUpperCase()}</p>
            <h1 className="text-xl font-semibold text-slate-900 mt-0.5">
              {activeTab === 'products'
                ? 'Catalog & Media Management'
                : activeTab === 'cj'
                  ? 'CJ Dropshipping Search & Import'
                  : activeTab === 'orders'
                    ? 'Verified Paid Orders & Pickup Queue'
                    : 'Live Server Environment Diagnostics'}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => adminToken && loadWorkspaceData(adminToken)}
            className="min-h-[44px] px-4 py-2 text-xs font-medium bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
          >
            Refresh Data
          </button>
        </div>

        {actionNotice && (
          <div className="p-3.5 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-900">
            {actionNotice}
          </div>
        )}
        {actionError && (
          <div className="p-3.5 rounded-md border border-red-200 bg-red-50 text-xs text-red-800">
            {actionError}
          </div>
        )}

        {activeTab === 'products' && (
          <div className="space-y-8">
            {/* Managed Category Directory */}
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Tag className="w-4 h-4" />
                    <span>Category Directory ({categories.length})</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Create, rename, or remove storefront collections. Categories with active products cannot be deleted.
                  </p>
                </div>

                <form onSubmit={handleAddCategorySubmit} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="New category name..."
                    aria-label="New category name"
                    className="min-h-[44px] w-48 px-3 text-sm bg-slate-50 border border-slate-200 rounded-md"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[44px] px-4 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer shrink-0"
                  >
                    Add Category
                  </button>
                </form>
              </div>

              {categories.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">No categories configured yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                  {categories.map((cat) => {
                    const isRenaming = renamingCategoryId === cat.id;
                    return (
                      <div
                        key={cat.id}
                        className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
                      >
                        {isRenaming ? (
                          <div className="flex flex-wrap items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={renameCategoryDraft}
                              onChange={(e) => setRenameCategoryDraft(e.target.value)}
                              aria-label={`Rename category ${cat.name}`}
                              className="min-h-[40px] px-3 text-sm border border-slate-300 rounded-md flex-1 min-w-[180px]"
                              autoFocus
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleRenameCategory(cat.id)}
                              className="min-h-[40px] px-3 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setRenamingCategoryId(null);
                                setRenameCategoryDraft('');
                              }}
                              className="min-h-[40px] px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-sm font-medium text-slate-900">{cat.name}</span>
                              <span className="text-xs font-mono text-slate-500 tabular-nums">
                                {cat.productCount} active product{cat.productCount === 1 ? '' : 's'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setRenamingCategoryId(cat.id);
                                  setRenameCategoryDraft(cat.name);
                                }}
                                className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Rename</span>
                              </button>
                              <button
                                type="button"
                                disabled={busy || cat.productCount > 0}
                                title={
                                  cat.productCount > 0
                                    ? 'Reassign or remove active products before deleting this category'
                                    : 'Delete empty category'
                                }
                                onClick={() => void handleDeleteCategory(cat)}
                                className="min-h-[36px] px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed rounded inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Add Manual Product Form */}
            <form
              onSubmit={handleCreateProduct}
              className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  <span>Add Product to Authoritative Catalog</span>
                </h2>
                <label className="min-h-[40px] px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Image</span>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="new-product-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Product Name
                  </label>
                  <input
                    id="new-product-name"
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Brass Pocket Compass"
                    className="w-full min-h-[44px] px-3 text-sm border border-slate-200 rounded-md"
                  />
                </div>
                <div>
                  <CategorySelector
                    id="new-product-category"
                    label="Category"
                    categories={categories}
                    value={newCategory}
                    onChange={setNewCategory}
                    onCreateCategory={handleCreateCategory}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label htmlFor="new-product-price" className="block text-xs font-medium text-slate-700 mb-1">
                    Retail Price (USD)
                  </label>
                  <input
                    id="new-product-price"
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={newPriceUsd}
                    onChange={(e) => setNewPriceUsd(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="new-product-image" className="block text-xs font-medium text-slate-700 mb-1">
                  Image Path
                </label>
                <input
                  id="new-product-image"
                  type="text"
                  required
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  className="w-full min-h-[44px] px-3 text-xs font-mono border border-slate-200 rounded-md"
                />
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-700">Product Variants</p>
                  <button
                    type="button"
                    onClick={() =>
                      setNewVariants((prev) => [
                        ...prev,
                        {
                          sku: `KRA-NEW-${String(prev.length + 1).padStart(2, '0')}`,
                          label: `Option ${prev.length + 1}`,
                          stock: '10',
                        },
                      ])
                    }
                    className="min-h-[36px] px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Variant</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {newVariants.map((variant, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end bg-slate-50 p-3 rounded-md border border-slate-200"
                    >
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Variant SKU
                        </label>
                        <input
                          type="text"
                          required
                          value={variant.sku}
                          onChange={(e) =>
                            setNewVariants((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, sku: e.target.value } : row))
                            )
                          }
                          className="w-full min-h-[40px] px-3 text-xs font-mono bg-white border border-slate-200 rounded-md"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Variant Label
                        </label>
                        <input
                          type="text"
                          required
                          value={variant.label}
                          onChange={(e) =>
                            setNewVariants((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, label: e.target.value } : row))
                            )
                          }
                          className="w-full min-h-[40px] px-3 text-xs bg-white border border-slate-200 rounded-md"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Stock
                        </label>
                        <input
                          type="number"
                          min="0"
                          required
                          value={variant.stock}
                          onChange={(e) =>
                            setNewVariants((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, stock: e.target.value } : row))
                            )
                          }
                          className="w-full min-h-[40px] px-3 text-xs font-mono bg-white border border-slate-200 rounded-md"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          disabled={newVariants.length <= 1}
                          onClick={() =>
                            setNewVariants((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label={`Remove variant row ${idx + 1}`}
                          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-red-700 hover:bg-red-50 disabled:opacity-30 rounded-md cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="new-product-description" className="block text-xs font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  id="new-product-description"
                  required
                  minLength={10}
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Describe material, construction, and dimensions..."
                  className="w-full p-3 text-sm border border-slate-200 rounded-md"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 py-2.5 text-sm font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
              >
                Save Product
              </button>
            </form>

            {(() => {
              const normalizedCatalogQuery = catalogSearchQuery.trim().toLowerCase();
              const filteredProducts = normalizedCatalogQuery
                ? products.filter(
                    (p) =>
                      p.name.toLowerCase().includes(normalizedCatalogQuery) ||
                      p.variants.some((v) => v.sku.toLowerCase().includes(normalizedCatalogQuery))
                  )
                : products;

              return (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-600">
                      Showing {filteredProducts.length} of {products.length} product
                      {products.length === 1 ? '' : 's'}
                    </p>
                    <div className="relative w-full sm:w-80">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="search"
                        aria-label="Filter catalog products by name or SKU"
                        value={catalogSearchQuery}
                        onChange={(e) => setCatalogSearchQuery(e.target.value)}
                        placeholder="Search product name or SKU..."
                        className="w-full min-h-[44px] pl-10 pr-4 text-sm bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>

                  {filteredProducts.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500 space-y-3">
                      <p>
                        {products.length === 0
                          ? 'No products in catalog yet.'
                          : `No products match "${catalogSearchQuery.trim()}".`}
                      </p>
                      {products.length > 0 && catalogSearchQuery.trim() && (
                        <button
                          type="button"
                          onClick={() => setCatalogSearchQuery('')}
                          className="min-h-[40px] px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                        >
                          Clear Search
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                          <tr>
                            <th className="py-3 px-4">Product</th>
                            <th className="py-3 px-4">Source</th>
                            <th className="py-3 px-4">Category</th>
                            <th className="py-3 px-4 text-right">Retail Price</th>
                            <th className="py-3 px-4 text-right">Stock</th>
                            <th className="py-3 px-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredProducts.map((p) => {
                            const totalStock = p.variants.reduce((s, v) => s + v.stock, 0);
                            return (
                              <tr key={p.id} className="hover:bg-slate-50">
                                <td className="py-3 px-4">
                                  <div className="font-medium text-slate-900">{p.name}</div>
                                  <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                                    {p.variants.map((v) => v.sku).join(', ')}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-xs text-slate-600 uppercase">
                                  {p.source}
                                </td>
                                <td className="py-3 px-4 text-xs text-slate-600">{p.category}</td>
                                <td className="py-3 px-4 text-right font-mono tabular-nums">
                                  {formatMoney(p.retailPriceCents, 'USD')}
                                </td>
                                <td className="py-3 px-4 text-right font-mono tabular-nums">
                                  {totalStock}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="inline-flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => openEditModal(p)}
                                      className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                      <span>Edit</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveProduct(p.id)}
                                      className="min-h-[36px] px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 rounded inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>Remove</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'cj' && (
          <div className="space-y-6">
            <form onSubmit={handleSearchCj} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={cjQuery}
                  onChange={(e) => setCjQuery(e.target.value)}
                  placeholder="Search CJ Dropshipping catalog (e.g. flask, sling, pen)..."
                  className="w-full min-h-[44px] pl-10 pr-4 text-sm bg-white border border-slate-200 rounded-md"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 py-2.5 text-sm font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
              >
                Search Supplier Catalog
              </button>
            </form>

            <div className="p-3.5 rounded-md border border-slate-200 bg-white text-xs text-slate-600 flex items-center justify-between gap-4">
              <span>
                Mode: <strong className="text-slate-900 uppercase">{cjSourceMode}</strong> · CJ_API_KEY stays strictly on the backend. Supplier cost is snapshotted and supplier orders are never placed automatically.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cjItems.map((item) => {
                const suggestedMarginPct =
                  item.suggestedRetailCents > 0
                    ? Math.round(
                        ((item.suggestedRetailCents - item.supplierCostCents) /
                          item.suggestedRetailCents) *
                          100
                      )
                    : 0;
                return (
                  <div
                    key={item.cjProductId}
                    className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono text-slate-500">
                            {item.cjProductId} · {item.category}
                          </p>
                          <h3 className="text-base font-semibold text-slate-900 mt-1">{item.name}</h3>
                        </div>
                        <Package className="w-5 h-5 text-slate-400 shrink-0" />
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{item.description}</p>
                      <div className="grid grid-cols-2 gap-2 pt-1 text-xs font-mono tabular-nums">
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                          <span className="block text-[10px] text-slate-500 uppercase">Wholesale Cost</span>
                          <span className="font-semibold text-slate-900">
                            {formatMoney(item.supplierCostCents, 'USD')}
                          </span>
                        </div>
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                          <span className="block text-[10px] text-slate-500 uppercase">Suggested Retail</span>
                          <span className="font-semibold text-slate-900">
                            {formatMoney(item.suggestedRetailCents, 'USD')} ({suggestedMarginPct}% margin)
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-slate-500 tabular-nums">
                        {item.variants.length} variant{item.variants.length === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openCjReviewModal(item)}
                        className="min-h-[44px] px-4 py-2 text-sm font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
                      >
                        Review &amp; Import
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'orders' && (() => {
          const normalizedQuery = orderSearchQuery.trim().toLowerCase();
          const hasDateFilter = Boolean(orderDateRange.from || orderDateRange.to);
          const filteredOrders = orders.filter((ord) => {
            if (
              normalizedQuery &&
              !ord.orderReference.toLowerCase().includes(normalizedQuery) &&
              !ord.customerName.toLowerCase().includes(normalizedQuery) &&
              !ord.email.toLowerCase().includes(normalizedQuery)
            ) {
              return false;
            }
            return isOrderCreatedWithinRange(ord.createdAt, orderDateRange);
          });
          const visibleRefs = filteredOrders.map((o) => o.orderReference);
          const selectedSet = new Set(selectedOrderRefs);
          const allVisibleSelected =
            visibleRefs.length > 0 && visibleRefs.every((ref) => selectedSet.has(ref));

          const toggleSelectAllVisible = () => {
            if (allVisibleSelected) {
              const visibleSet = new Set(visibleRefs);
              setSelectedOrderRefs((prev) => prev.filter((ref) => !visibleSet.has(ref)));
            } else {
              setSelectedOrderRefs((prev) => Array.from(new Set([...prev, ...visibleRefs])));
            }
          };

          const toggleSelectOne = (ref: string) => {
            setSelectedOrderRefs((prev) =>
              prev.includes(ref) ? prev.filter((item) => item !== ref) : [...prev, ref]
            );
          };

          return (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOrderFilter('PAID');
                    if (adminToken) loadWorkspaceData(adminToken, 'PAID');
                  }}
                  className={`min-h-[44px] px-3.5 text-xs font-medium rounded-md border cursor-pointer ${
                    orderFilter === 'PAID'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  Confirmed PAID Orders
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOrderFilter('ALL');
                    if (adminToken) loadWorkspaceData(adminToken, 'ALL');
                  }}
                  className={`min-h-[44px] px-3.5 text-xs font-medium rounded-md border cursor-pointer ${
                    orderFilter === 'ALL'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  All Orders
                </button>
              </div>

              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  aria-label="Filter orders by customer name, email, or order reference"
                  value={orderSearchQuery}
                  onChange={(e) => setOrderSearchQuery(e.target.value)}
                  placeholder="Search name, email, or order ref..."
                  className="w-full min-h-[44px] pl-10 pr-4 text-sm bg-white border border-slate-200 rounded-md"
                />
              </div>
            </div>

            <DateRangePicker value={orderDateRange} onChange={setOrderDateRange} />

            {selectedOrderRefs.length > 0 && (
              <div
                role="region"
                aria-label="Bulk order fulfillment actions"
                className="bg-slate-900 text-white rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold font-mono tabular-nums">
                    {selectedOrderRefs.length} order{selectedOrderRefs.length === 1 ? '' : 's'} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedOrderRefs([])}
                    className="text-xs text-slate-300 hover:text-white underline cursor-pointer"
                  >
                    Clear selection
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Bulk fulfillment status"
                    disabled={busy}
                    value={bulkFulfillmentStatus}
                    onChange={(e) => setBulkFulfillmentStatus(e.target.value as FulfillmentStatus)}
                    className="min-h-[40px] px-3 text-xs text-slate-900 bg-white border border-slate-300 rounded-md"
                  >
                    <option value="PROCESSING">Processing</option>
                    <option value="READY_FOR_PICKUP">Ready for Pickup (Locks /track)</option>
                    <option value="DISPATCHED">Dispatched (Locked)</option>
                    <option value="DELIVERED">Delivered (Locked)</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleBulkOrderStatusChange}
                    className="min-h-[40px] px-4 text-xs font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-500 cursor-pointer"
                  >
                    {busy ? 'Updating...' : 'Apply to Selected'}
                  </button>
                </div>
              </div>
            )}

            {filteredOrders.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500 space-y-3">
                <p>
                  {orders.length === 0
                    ? `No ${orderFilter === 'PAID' ? 'verified PAID' : ''} orders recorded yet.`
                    : normalizedQuery && hasDateFilter
                      ? `No orders match "${orderSearchQuery.trim()}" within the selected creation date range.`
                      : hasDateFilter
                        ? 'No orders created within the selected date range.'
                        : `No orders match "${orderSearchQuery.trim()}".`}
                </p>
                {orders.length > 0 && (normalizedQuery || hasDateFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setOrderSearchQuery('');
                      setOrderDateRange({ from: '', to: '' });
                    }}
                    className="min-h-[40px] px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                    <tr>
                      <th className="py-3 pl-4 pr-2 w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all visible orders"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          className="w-4 h-4 rounded border-slate-300 accent-slate-900 cursor-pointer"
                        />
                      </th>
                      <th className="py-3 px-4">Order Ref</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Payment</th>
                      <th className="py-3 px-4">Pickup Station</th>
                      <th className="py-3 px-4 text-right">Settled</th>
                      <th className="py-3 px-4">Fulfillment Stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredOrders.map((ord) => {
                      const isChecked = selectedSet.has(ord.orderReference);
                      return (
                      <tr
                        key={ord.orderReference}
                        className={isChecked ? 'bg-slate-50' : 'hover:bg-slate-50'}
                      >
                        <td className="py-3 pl-4 pr-2">
                          <input
                            type="checkbox"
                            aria-label={`Select order ${ord.orderReference}`}
                            checked={isChecked}
                            onChange={() => toggleSelectOne(ord.orderReference)}
                            className="w-4 h-4 rounded border-slate-300 accent-slate-900 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-xs font-semibold text-slate-900">
                            {ord.orderReference}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                            {new Date(ord.createdAt).toLocaleString()}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700">
                          <div className="font-medium text-slate-900">{ord.customerName}</div>
                          <div>{ord.email}</div>
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <span className="font-semibold text-slate-900">{ord.paymentStatus}</span> ·{' '}
                          <span className="uppercase text-slate-600">{ord.paymentMethod}</span>
                          {ord.providerRefs.mpesaReceiptNumber && (
                            <div className="font-mono text-[11px] text-slate-500">
                              {ord.providerRefs.mpesaReceiptNumber}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700">
                          <div className="font-medium text-slate-900">
                            {ord.pickupPoint.stationName}
                          </div>
                          <div>{ord.pickupPoint.area}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">
                          {formatMoney(ord.chargedAmountMinor, ord.chargedCurrency)}
                        </td>
                        <td className="py-3 px-4">
                          <select
                            aria-label={`Fulfillment status for ${ord.orderReference}`}
                            disabled={ord.paymentStatus !== 'PAID' || busy}
                            value={ord.fulfillmentStatus}
                            onChange={(e) =>
                              handleOrderStatusChange(
                                ord.orderReference,
                                e.target.value as FulfillmentStatus
                              )
                            }
                            className="min-h-[38px] px-2.5 text-xs bg-white border border-slate-200 rounded-md"
                          >
                            <option value="AWAITING_PAYMENT">Awaiting Payment</option>
                            <option value="PROCESSING">Processing</option>
                            <option value="READY_FOR_PICKUP">Ready for Pickup (Locks /track)</option>
                            <option value="DISPATCHED">Dispatched (Locked)</option>
                            <option value="DELIVERED">Delivered (Locked)</option>
                          </select>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          );
        })()}

        {activeTab === 'diagnostics' && (
          <div className="space-y-5">
            {/* Dedicated Safaricom Daraja Sandbox Authorization Card */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Safaricom Daraja Sandbox Authorization Check
                    </h2>
                    {darajaSandboxResult && (
                      <span
                        className={`inline-block px-2 py-0.5 text-[11px] font-mono font-semibold border rounded ${
                          darajaSandboxResult.status === 'WORKING'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : darajaSandboxResult.status === 'MISCONFIGURED'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : darajaSandboxResult.status === 'UNCONFIGURED'
                                ? 'bg-slate-100 text-slate-700 border-slate-200'
                                : 'bg-red-50 text-red-800 border-red-200'
                        }`}
                      >
                        {darajaSandboxResult.status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Queries{' '}
                    <span className="font-mono text-slate-800">sandbox.safaricom.co.ke</span>{' '}
                    OAuth and STK Push Query endpoints to confirm whether{' '}
                    <span className="font-mono text-slate-800">MPESA_CONSUMER_KEY</span> and{' '}
                    <span className="font-mono text-slate-800">MPESA_PASSKEY</span> are authorized
                    to sign and initiate Lipa Na M-Pesa requests without triggering a customer
                    phone prompt.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={darajaLoading || diagLoading}
                  onClick={handleRunDarajaSandboxCheck}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  {darajaLoading ? 'Querying Daraja Sandbox...' : 'Verify Daraja Sandbox Auth'}
                </button>
              </div>

              {darajaSandboxResult && (
                <div className="pt-3 border-t border-slate-100 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-md bg-slate-50 border border-slate-200">
                      <p className="text-[11px] font-medium text-slate-500">
                        Step 1 · MPESA_CONSUMER_KEY (OAuth)
                      </p>
                      <p className="text-xs font-mono font-semibold text-slate-900 mt-1">
                        {darajaSandboxResult.oauthAuthorized ? 'AUTHORIZED' : 'NOT AUTHORIZED'}
                        {darajaSandboxResult.oauthHttpStatus
                          ? ` (HTTP ${darajaSandboxResult.oauthHttpStatus})`
                          : ''}
                      </p>
                    </div>
                    <div className="p-3 rounded-md bg-slate-50 border border-slate-200">
                      <p className="text-[11px] font-medium text-slate-500">
                        Step 2 · MPESA_PASSKEY (STK Signing)
                      </p>
                      <p className="text-xs font-mono font-semibold text-slate-900 mt-1">
                        {darajaSandboxResult.stkAuthorized ? 'AUTHORIZED' : 'NOT AUTHORIZED'}
                        {darajaSandboxResult.stkHttpStatus
                          ? ` (HTTP ${darajaSandboxResult.stkHttpStatus})`
                          : ''}
                      </p>
                    </div>
                    <div className="p-3 rounded-md bg-slate-50 border border-slate-200">
                      <p className="text-[11px] font-medium text-slate-500">
                        Sandbox Target &amp; Code
                      </p>
                      <p className="text-xs font-mono font-semibold text-slate-900 mt-1">
                        {darajaSandboxResult.darajaCode || darajaSandboxResult.mpesaEnvConfigured}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {darajaSandboxResult.detail}
                  </p>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <p className="text-sm font-semibold text-slate-900">
                  Full Server-Side Secrets Verification
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Secrets added in AI Studio are injected directly into server-side process.env and
                  are never written to disk (.env) or returned to browsers. Active database mode:{' '}
                  <strong className="font-mono text-slate-900 uppercase">
                    {diagnosticsDbMode || 'pending check'}
                  </strong>
                  .
                </p>
              </div>
              <button
                type="button"
                disabled={diagLoading}
                onClick={() => handleRunDiagnostics()}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold bg-white text-slate-900 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                {diagLoading ? 'Running Checks...' : 'Run Full Integration Check'}
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Environment Variable</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Verification Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {diagnostics.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 px-4 text-center text-xs text-slate-500">
                        {diagLoading
                          ? 'Checking live MongoDB, Stripe, Daraja M-Pesa, CJ, and Firebase configurations...'
                          : 'Click "Run Live Integration Check" to inspect server-side secrets.'}
                      </td>
                    </tr>
                  ) : (
                    diagnostics.map((entry) => {
                      const statusStyle =
                        entry.status === 'WORKING' || entry.status === 'CONFIGURED'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : entry.status === 'UNCONFIGURED'
                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                            : entry.status === 'MISCONFIGURED'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-red-50 text-red-800 border-red-200';
                      return (
                        <tr key={entry.name} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900">
                            {entry.name}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-block px-2 py-0.5 text-[11px] font-mono font-semibold border rounded ${statusStyle}`}
                            >
                              {entry.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700">{entry.detail}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {editingProduct && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-product-modal-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) {
              setEditingProduct(null);
            }
          }}
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-slate-500">{editingProduct.id}</p>
                <h2 id="edit-product-modal-title" className="text-base font-semibold text-slate-900">
                  Edit Price &amp; Stock · {editingProduct.name}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close edit product modal"
                disabled={busy}
                onClick={() => setEditingProduct(null)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateProduct} className="p-5 space-y-5">
              <CategorySelector
                id="edit-product-category"
                label="Category"
                categories={categories}
                value={editCategory}
                onChange={setEditCategory}
                onCreateCategory={handleCreateCategory}
                disabled={busy}
              />

              <div>
                <label
                  htmlFor="edit-retail-price"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Retail Price (USD)
                </label>
                <input
                  id="edit-retail-price"
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={editPriceUsd}
                  onChange={(e) => setEditPriceUsd(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 text-sm font-mono border border-slate-200 rounded-md"
                />
                {editingProduct.supplierCostCents !== undefined && (
                  <p className="text-[11px] text-slate-500 font-mono mt-1">
                    Supplier cost snapshot: {formatMoney(editingProduct.supplierCostCents, 'USD')}
                  </p>
                )}
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-medium text-slate-700">Variant Stock Levels</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
                  {editingProduct.variants.map((variant) => (
                    <div
                      key={variant.sku}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-4 bg-white"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-900 truncate">
                          {variant.label}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500">{variant.sku}</p>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required
                        aria-label={`Stock for ${variant.sku}`}
                        value={editVariantStocks[variant.sku] ?? ''}
                        onChange={(e) =>
                          setEditVariantStocks((prev) => ({
                            ...prev,
                            [variant.sku]: e.target.value,
                          }))
                        }
                        className="w-28 min-h-[40px] px-3 text-sm font-mono text-right border border-slate-200 rounded-md"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditingProduct(null)}
                  className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] px-5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
                >
                  {busy ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reviewingCjItem && (() => {
        const retailCents = Math.round(Number(cjImportRetailUsd) * 100);
        const validRetail = Number.isFinite(retailCents) && retailCents > 0;
        const profitCents = validRetail ? retailCents - reviewingCjItem.supplierCostCents : 0;
        const marginPct = validRetail ? Math.round((profitCents / retailCents) * 100) : 0;
        const belowCost = validRetail && retailCents <= reviewingCjItem.supplierCostCents;

        return (
          <div
            className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cj-import-modal-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) {
                setReviewingCjItem(null);
              }
            }}
          >
            <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
                <div>
                  <p className="text-xs font-mono text-slate-500">
                    CJ Dropshipping · {reviewingCjItem.cjProductId}
                  </p>
                  <h2 id="cj-import-modal-title" className="text-base font-semibold text-slate-900">
                    Review &amp; Publish to Storefront
                  </h2>
                </div>
                <button
                  type="button"
                  aria-label="Close CJ import modal"
                  disabled={busy}
                  onClick={() => setReviewingCjItem(null)}
                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleConfirmCjImport} className="p-5 space-y-5 overflow-y-auto">
                <div className="p-3 rounded-md bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="text-slate-500">Supplier Wholesale Cost Snapshot: </span>
                    <strong className="font-mono tabular-nums text-slate-900">
                      {formatMoney(reviewingCjItem.supplierCostCents, 'USD')}
                    </strong>
                  </div>
                  <span className="text-slate-600">
                    Supplier orders are never placed automatically.
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="cj-import-name"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Storefront Product Title
                    </label>
                    <input
                      id="cj-import-name"
                      type="text"
                      required
                      minLength={2}
                      value={cjImportName}
                      onChange={(e) => setCjImportName(e.target.value)}
                      className="w-full min-h-[44px] px-3 text-sm border border-slate-200 rounded-md"
                    />
                  </div>

                  <div>
                    <CategorySelector
                      id="cj-import-category"
                      label="Storefront Category"
                      categories={categories}
                      value={cjImportCategory}
                      onChange={setCjImportCategory}
                      onCreateCategory={handleCreateCategory}
                      disabled={busy}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="cj-import-description"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Storefront Description
                  </label>
                  <textarea
                    id="cj-import-description"
                    rows={3}
                    required
                    minLength={5}
                    value={cjImportDescription}
                    onChange={(e) => setCjImportDescription(e.target.value)}
                    className="w-full p-3 text-sm border border-slate-200 rounded-md"
                  />
                </div>

                <div className="p-4 rounded-md border border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex-1 min-w-[180px]">
                      <label
                        htmlFor="cj-import-retail-usd"
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Retail Price (USD)
                      </label>
                      <input
                        id="cj-import-retail-usd"
                        type="number"
                        step="0.01"
                        min="1"
                        required
                        value={cjImportRetailUsd}
                        onChange={(e) => setCjImportRetailUsd(e.target.value)}
                        className="w-full min-h-[44px] px-3 text-sm font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      {[2, 2.5, 3].map((multiplier) => (
                        <button
                          key={multiplier}
                          type="button"
                          onClick={() =>
                            setCjImportRetailUsd(
                              ((reviewingCjItem.supplierCostCents * multiplier) / 100).toFixed(2)
                            )
                          }
                          className="min-h-[44px] px-3 text-xs font-mono font-medium bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                        >
                          {multiplier.toFixed(1)}x Markup
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums pt-2 border-t border-slate-200">
                    <span className="text-slate-700">
                      Gross Profit:{' '}
                      <strong className={profitCents > 0 ? 'text-emerald-700' : 'text-red-700'}>
                        {validRetail ? formatMoney(profitCents, 'USD') : '—'}
                      </strong>
                    </span>
                    <span className="text-slate-700">
                      Margin:{' '}
                      <strong className={marginPct > 0 ? 'text-emerald-700' : 'text-red-700'}>
                        {validRetail ? `${marginPct}%` : '—'}
                      </strong>
                    </span>
                  </div>

                  {belowCost && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      Retail price is at or below wholesale supplier cost. Adjust markup before publishing.
                    </p>
                  )}
                </div>

                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-slate-700">Variant Initial Stock Caps</p>
                  <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
                    {reviewingCjItem.variants.map((variant) => (
                      <div
                        key={variant.sku}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-4 bg-white"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-900 truncate">
                            {variant.label}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {variant.sku} · Wholesale {formatMoney(variant.supplierCostCents, 'USD')}
                          </p>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          required
                          aria-label={`Initial stock for ${variant.sku}`}
                          value={cjImportVariantStocks[variant.sku] ?? ''}
                          onChange={(e) =>
                            setCjImportVariantStocks((prev) => ({
                              ...prev,
                              [variant.sku]: e.target.value,
                            }))
                          }
                          className="w-28 min-h-[40px] px-3 text-sm font-mono text-right border border-slate-200 rounded-md"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setReviewingCjItem(null)}
                    className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[44px] px-5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
                  >
                    {busy ? 'Publishing...' : 'Publish to Storefront'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
