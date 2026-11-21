import React, { useState } from 'react';
import { Plus } from 'lucide-react';

interface CategorySelectorProps {
  id?: string;
  label: string;
  categories: Array<{ id?: string; name: string }>;
  value: string;
  onChange: (name: string) => void;
  onCreateCategory: (name: string) => Promise<string>;
  disabled?: boolean;
}

const CREATE_SENTINEL = '__new__';

export const CategorySelector: React.FC<CategorySelectorProps> = ({
  id,
  label,
  categories,
  value,
  onChange,
  onCreateCategory,
  disabled = false,
}) => {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionNames = React.useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();
    for (const c of categories) {
      const clean = c.name.trim();
      if (!clean) continue;
      const lower = clean.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        list.push(clean);
      }
    }
    const cleanVal = value.trim();
    if (cleanVal && !seen.has(cleanVal.toLowerCase())) {
      list.unshift(cleanVal);
    }
    return list;
  }, [categories, value]);

  const handleConfirmCreate = async () => {
    const trimmed = draftName.trim();
    if (trimmed.length < 2) {
      setError('Enter at least 2 characters');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const createdName = await onCreateCategory(trimmed);
      onChange(createdName);
      setDraftName('');
      setCreating(false);
    } catch (err) {
      setError((err as Error).message || 'Could not create category');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-medium text-slate-700">
        {label}
      </label>

      {creating ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draftName}
              disabled={disabled || saving}
              onChange={(e) => {
                setDraftName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleConfirmCreate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setCreating(false);
                  setDraftName('');
                  setError(null);
                }
              }}
              placeholder="e.g. Stationery"
              aria-label={`New ${label.toLowerCase()} name`}
              className="flex-1 min-w-0 min-h-[44px] px-3 text-sm bg-white border border-slate-300 rounded-md"
              autoFocus
            />
            <button
              type="button"
              disabled={disabled || saving}
              onClick={() => void handleConfirmCreate()}
              className="min-h-[44px] px-3.5 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer shrink-0"
            >
              {saving ? 'Adding...' : 'Add'}
            </button>
            <button
              type="button"
              disabled={disabled || saving}
              onClick={() => {
                setCreating(false);
                setDraftName('');
                setError(null);
              }}
              className="min-h-[44px] px-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer shrink-0"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className="text-[11px] text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <select
            id={id}
            disabled={disabled}
            value={value}
            onChange={(e) => {
              if (e.target.value === CREATE_SENTINEL) {
                setCreating(true);
                setError(null);
              } else {
                onChange(e.target.value);
              }
            }}
            className="flex-1 min-w-0 min-h-[44px] px-3 text-sm bg-white border border-slate-200 rounded-md"
          >
            {optionNames.map((catName) => (
              <option key={catName} value={catName}>
                {catName}
              </option>
            ))}
            <option value={CREATE_SENTINEL}>+ New category...</option>
          </select>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
            title="Create new category"
            aria-label="Create new category"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center border border-slate-200 rounded-md bg-white text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default CategorySelector;
