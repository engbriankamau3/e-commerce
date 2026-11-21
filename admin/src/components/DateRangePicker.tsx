import React from 'react';
import { Calendar, X } from 'lucide-react';

export interface DateRange {
  from: string; // YYYY-MM-DD or ''
  to: string; // YYYY-MM-DD or ''
}

function toLocalDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function isOrderCreatedWithinRange(createdAtIso: string, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  const createdMs = new Date(createdAtIso).getTime();
  if (!Number.isFinite(createdMs)) return false;

  if (range.from) {
    const [y, m, d] = range.from.split('-').map(Number);
    if (y && m && d) {
      const startMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
      if (createdMs < startMs) return false;
    }
  }

  if (range.to) {
    const [y, m, d] = range.to.split('-').map(Number);
    if (y && m && d) {
      const endMs = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
      if (createdMs > endMs) return false;
    }
  }

  return true;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (next: DateRange) => void;
}

export default function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const hasFilter = Boolean(value.from || value.to);

  const applyPresetDays = (daysBack: number) => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - daysBack);
    onChange({
      from: toLocalDateInputValue(start),
      to: toLocalDateInputValue(now),
    });
  };

  const todayStr = toLocalDateInputValue(new Date());
  const sevenDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return toLocalDateInputValue(d);
  })();
  const thirtyDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return toLocalDateInputValue(d);
  })();

  const isTodayPreset = value.from === todayStr && value.to === todayStr;
  const is7dPreset = value.from === sevenDaysAgo && value.to === todayStr;
  const is30dPreset = value.from === thirtyDaysAgo && value.to === todayStr;

  return (
    <div
      role="group"
      aria-label="Filter orders by creation date range"
      className="bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 pr-1">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <span>Created Date</span>
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => applyPresetDays(0)}
            className={`min-h-[34px] px-2.5 text-xs font-medium rounded border cursor-pointer ${
              isTodayPreset
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => applyPresetDays(6)}
            className={`min-h-[34px] px-2.5 text-xs font-medium rounded border cursor-pointer ${
              is7dPreset
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            Last 7d
          </button>
          <button
            type="button"
            onClick={() => applyPresetDays(29)}
            className={`min-h-[34px] px-2.5 text-xs font-medium rounded border cursor-pointer ${
              is30dPreset
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            Last 30d
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <span>From</span>
          <input
            type="date"
            aria-label="Order created from date"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => {
              const nextFrom = e.target.value;
              onChange({
                from: nextFrom,
                to: value.to && nextFrom && nextFrom > value.to ? nextFrom : value.to,
              });
            }}
            className="min-h-[38px] px-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-900"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <span>To</span>
          <input
            type="date"
            aria-label="Order created to date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => {
              const nextTo = e.target.value;
              onChange({
                from: value.from && nextTo && nextTo < value.from ? nextTo : value.from,
                to: nextTo,
              });
            }}
            className="min-h-[38px] px-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-900"
          />
        </label>

        {hasFilter && (
          <button
            type="button"
            onClick={() => onChange({ from: '', to: '' })}
            aria-label="Clear creation date range filter"
            className="min-h-[38px] px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md inline-flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        )}
      </div>
    </div>
  );
}
