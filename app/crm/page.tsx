'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  Phone, Mail, Search,
  MapPin, BarChart2, BookOpen, Clock,
  DollarSign, User, Building2,
  CheckCircle2, Circle, XCircle, Flame,
  TrendingUp, Save
} from 'lucide-react'

type Deal = {
  id: string
  owner_name: string
  tract_abstract?: string | null
  tract_survey?: string | null
  operator_name?: string | null
  mailing_address?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  acreage?: number | null
  monthly_royalty?: number | null
  propensity_score?: number | null
  tag?: string | null
  offer_amount?: number | null
  follow_up_date?: string | null
  source?: string | null
  notes?: string | null
  phone?: string | null
  email?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type ContactEntry = {
  id: string
  deal_id: string
  logged_at: string
  method: string
  outcome?: string | null
  notes?: string | null
}

type Task = { id: string; text: string; done: boolean; dealId: string }

const TAG_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  hot:            { label: 'Hot',           color: 'text-red-700',     bg: 'bg-red-50 border-red-200',       icon: <Flame size={11} /> },
  nurture:        { label: 'Nurture',       color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',   icon: <TrendingUp size={11} /> },
  prospect:       { label: 'Prospect',      color: 'text-green-700',   bg: 'bg-green-50 border-green-200',   icon: <TrendingUp size={11} /> },
  not_interested: { label: 'Not Interested',color: 'text-slate-400',   bg: 'bg-slate-50 border-slate-100',   icon: <XCircle size={11} /> },
  skip_traced:    { label: 'Skip Traced',   color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={11} /> },
  offer_sent:     { label: 'Offer Sent',    color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',     icon: <DollarSign size={11} /> },
  closed:         { label: 'Closed',        color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={11} /> },
}

const TagBadge = ({ tag }: { tag: string }) => {
  const cfg = TAG_CONFIG[tag] ?? TAG_CONFIG.prospect
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

const isOverdue = (date: string) => new Date(date) < new Date()

const formatDate = (date: string) => {
  const d = new Date(date)
  const today = new Date()
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return `in ${diff}d`
}

export default function CRM() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [selected, setSelected] = useState<Deal | null>(null)
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
  const [contactLog, setContactLog] = useState<ContactEntry[]>([])
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState('all')
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    supabase.from('deals').select('*').order('updated_at', { ascending: false }).then(({ data }) => {
      setDeals((data as Deal[]) ?? [])
    })
  }, [])

  const filtered = useMemo(() => deals.filter((d) => {
    if (activeTag !== 'all' && (d.tag ?? 'prospect') !== activeTag) return false
    if (
      search &&
      !(d.owner_name ?? '').toLowerCase().includes(search.toLowerCase()) &&
      !(d.operator_name ?? '').toLowerCase().includes(search.toLowerCase())
    ) return false
    return true
  }), [deals, activeTag, search])

  const handleSelectDeal = async (deal: Deal) => {
    setSelected(deal)
    setEditingDeal({ ...deal, tag: deal.tag ?? 'prospect' })
    const { data } = await supabase
      .from('contact_log')
      .select('*')
      .eq('deal_id', deal.id)
      .order('logged_at', { ascending: false })
    setContactLog((data as ContactEntry[]) ?? [])
  }

  const handleSaveDeal = async (overrides?: Partial<Deal>) => {
    const toSave = { ...editingDeal, ...overrides }
    if (!toSave?.id) return

    const payload = {
      owner_name: toSave.owner_name ?? '',
      tract_abstract: toSave.tract_abstract ?? null,
      tract_survey: toSave.tract_survey ?? null,
      operator_name: toSave.operator_name ?? null,
      mailing_address: toSave.mailing_address ?? null,
      mailing_city: toSave.mailing_city ?? null,
      mailing_state: toSave.mailing_state ?? null,
      mailing_zip: toSave.mailing_zip ?? null,
      acreage: toSave.acreage === null || toSave.acreage === undefined ? null : Number(toSave.acreage),
      monthly_royalty: toSave.monthly_royalty === null || toSave.monthly_royalty === undefined ? null : Number(toSave.monthly_royalty),
      propensity_score: toSave.propensity_score === null || toSave.propensity_score === undefined ? null : Number(toSave.propensity_score),
      tag: toSave.tag ?? 'prospect',
      offer_amount: toSave.offer_amount === null || toSave.offer_amount === undefined ? null : Number(toSave.offer_amount),
      follow_up_date: toSave.follow_up_date || null,
      source: toSave.source ?? null,
      notes: toSave.notes ?? '',
      phone: toSave.phone ?? null,
      email: toSave.email ?? null,
      updated_at: new Date().toISOString(),
    }

    await supabase.from('deals').update(payload).eq('id', toSave.id)
    setDeals((prev) => prev.map((d) => d.id === toSave.id ? ({ ...d, ...payload } as Deal) : d))
    setSelected((prev) => prev?.id === toSave.id ? ({ ...prev, ...payload } as Deal) : prev)
    setEditingDeal((prev) => prev?.id === toSave.id ? ({ ...prev, ...payload } as Deal) : prev)
    setLastSaved('just now')
  }

  const handleTagChange = async (tag: string) => {
    if (!editingDeal) return
    setEditingDeal((prev) => prev ? { ...prev, tag } : null)
    await supabase.from('deals').update({ tag, updated_at: new Date().toISOString() }).eq('id', editingDeal.id)
    setDeals((prev) => prev.map((d) => d.id === editingDeal.id ? { ...d, tag } : d))
  }

  const handleLogContact = async (method: string) => {
    if (!editingDeal) return
    const loggedAt = new Date().toISOString()
    await supabase.from('contact_log').insert({ deal_id: editingDeal.id, method, logged_at: loggedAt })
    setContactLog((prev) => [{ id: Date.now().toString(), deal_id: editingDeal.id, logged_at: loggedAt, method }, ...prev])
  }

  const annual = editingDeal?.monthly_royalty ? Number(editingDeal.monthly_royalty) * 12 : 0

  return (
    <div className="h-screen flex flex-col bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-amber-400 rounded-md flex items-center justify-center">
            <span className="text-white text-sm font-bold">M</span>
          </div>
          <span className="font-serif text-base font-bold text-white">Mineral Map</span>
          <span className="text-gray-300 text-sm">·</span>
          <span className="text-sm font-medium text-gray-400">CRM & Pipeline</span>
        </div>
        <nav className="flex items-center gap-1">
          <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <MapPin size={13} />Map
          </Link>
          <Link href="/comps" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <BarChart2 size={13} />Comps
          </Link>
          <Link href="/methodology" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <BookOpen size={13} />Methodology
          </Link>
        </nav>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[260px] shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200 bg-white">
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: 'Total', val: deals.length },
                { label: 'Hot', val: deals.filter((d) => (d.tag ?? 'prospect') === 'hot').length, color: 'text-red-600' },
                { label: 'Follow up', val: deals.filter((d) => d.follow_up_date && isOverdue(d.follow_up_date)).length, color: 'text-amber-600' },
              ].map((s) => (
                <div key={s.label} className="text-center py-1">
                  <div className={`text-base font-bold font-serif ${s.color ?? 'text-gray-900'}`}>{s.val}</div>
                  <div className="text-xs text-gray-400">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="p-3 border-b border-gray-100">
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search owners, operators..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 focus:bg-white transition-all"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {['all', ...Object.keys(TAG_CONFIG)].map((tag) => (
                <button
                  key={tag}
                  onClick={() => setActiveTag(tag)}
                  className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                    activeTag === tag
                      ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {tag === 'all' ? 'All' : TAG_CONFIG[tag]?.label}
                  {tag !== 'all' && (
                    <span className="ml-1 text-gray-400">{deals.filter((d) => (d.tag ?? 'prospect') === tag).length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100 font-semibold">
            {filtered.length} leads
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-sm text-gray-400">No leads found</div>
              </div>
            ) : filtered.map((deal) => (
              <button
                key={deal.id}
                onClick={() => handleSelectDeal(deal)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selected?.id === deal.id ? 'bg-white border-l-2 border-l-amber-500 shadow-sm' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900 leading-tight">{deal.owner_name}</span>
                  <TagBadge tag={deal.tag ?? 'prospect'} />
                </div>
                <div className="text-xs text-gray-400 mb-1">
                  {deal.tract_abstract ?? '--'} · {deal.operator_name ?? '--'}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  {deal.mailing_city && <span>{deal.mailing_city}, {deal.mailing_state}</span>}
                  {deal.acreage ? <span>{deal.acreage} ac</span> : null}
                  {deal.monthly_royalty ? <span>${Number(deal.monthly_royalty).toLocaleString()}/mo</span> : null}
                </div>
                {deal.follow_up_date && (
                  <div className={`mt-1.5 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                    isOverdue(deal.follow_up_date)
                      ? 'bg-red-50 text-red-600'
                      : 'bg-amber-50 text-amber-600'
                  }`}>
                    <Clock size={10} />
                    {formatDate(deal.follow_up_date)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </aside>

        <main className="flex-1 overflow-hidden flex">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {!selected || !editingDeal ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <User size={20} className="text-gray-400" />
                  </div>
                  <div className="text-sm font-medium text-gray-500">Select a lead</div>
                  <div className="text-xs text-gray-400 mt-1">Choose a lead from the list to view details</div>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4 shadow-sm border-b-2 border-b-amber-400">
                  <div className="flex items-start justify-between mb-3">
                    <input
                      value={editingDeal.owner_name ?? ''}
                      onChange={(e) => setEditingDeal((p) => p ? { ...p, owner_name: e.target.value } : null)}
                      onBlur={() => handleSaveDeal()}
                      className="text-2xl font-bold tracking-tight text-gray-900 bg-transparent border-none outline-none w-full font-serif"
                    />
                    {lastSaved && (
                      <span className="text-xs text-gray-400 shrink-0 flex items-center gap-1 mt-1">
                        <Save size={11} />Saved {lastSaved}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(TAG_CONFIG).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => handleTagChange(key)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          editingDeal.tag === key
                            ? `${cfg.bg} ${cfg.color} shadow-sm`
                            : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                        }`}
                      >
                        {cfg.icon}{cfg.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4 shadow-sm">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">Lead Info</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {[
                      { label: 'Tract', field: 'tract_abstract', icon: <MapPin size={13} /> },
                      { label: 'Survey', field: 'tract_survey', icon: <MapPin size={13} /> },
                      { label: 'Operator', field: 'operator_name', icon: <Building2 size={13} /> },
                      { label: 'Address', field: 'mailing_address', icon: <MapPin size={13} /> },
                      { label: 'City', field: 'mailing_city', icon: null },
                      { label: 'State', field: 'mailing_state', icon: null },
                      { label: 'Zip', field: 'mailing_zip', icon: null },
                      { label: 'Acreage', field: 'acreage', icon: null },
                    ].map(({ label, field, icon }) => (
                      <div key={field}>
                        <div className="flex items-center gap-1 text-xs font-medium text-gray-400 mb-1">
                          {icon}{label}
                        </div>
                        <input
                          value={String(editingDeal[field as keyof Deal] ?? '')}
                          onChange={(e) => setEditingDeal((p) => p ? { ...p, [field]: e.target.value } : null)}
                          onBlur={() => handleSaveDeal()}
                          className="w-full text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 focus:bg-white transition-all"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-4 pt-4 border-t border-gray-100">
                    <div>
                      <div className="flex items-center gap-1 text-xs font-medium text-gray-400 mb-1"><Phone size={13} />Phone</div>
                      {editingDeal.phone ? (
                        <a href={`tel:${editingDeal.phone}`} className="text-sm text-amber-600 font-medium hover:underline">{editingDeal.phone}</a>
                      ) : (
                        <span className="text-sm text-gray-400 italic">Not skip traced</span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-xs font-medium text-gray-400 mb-1"><Mail size={13} />Email</div>
                      {editingDeal.email ? (
                        <a href={`mailto:${editingDeal.email}`} className="text-sm text-amber-600 font-medium hover:underline">{editingDeal.email}</a>
                      ) : (
                        <span className="text-sm text-gray-400 italic">Not skip traced</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4 shadow-sm">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">Offer & Valuation</div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        type="number"
                        placeholder="Your offer amount"
                        value={editingDeal.offer_amount ?? ''}
                        onChange={(e) => setEditingDeal((p) => p ? { ...p, offer_amount: e.target.value === '' ? null : Number(e.target.value) } : null)}
                        onBlur={() => handleSaveDeal()}
                        className="w-full pl-7 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all"
                      />
                    </div>
                  </div>
                  {annual > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Conservative', mult: 3, muted: true },
                        { label: 'Market Rate', mult: 4, muted: false },
                        { label: 'Aggressive', mult: 5, muted: true },
                      ].map((c) => (
                        <div key={c.mult} className={`rounded-lg p-3 text-center border ${c.muted ? 'bg-gray-50 border-gray-200' : 'bg-amber-50 border-amber-200'}`}>
                          <div className="text-xs text-gray-500 mb-1">{c.label} ({c.mult}x)</div>
                          <div className={`text-base font-bold font-serif ${c.muted ? 'text-gray-700' : 'text-amber-700'}`}>
                            ${(annual * c.mult).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4 shadow-sm">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">Follow-up Reminder</div>
                  <div className="flex items-center gap-3 mb-3">
                    <input
                      type="date"
                      value={editingDeal.follow_up_date ?? ''}
                      onChange={(e) => setEditingDeal((p) => p ? { ...p, follow_up_date: e.target.value } : null)}
                      onBlur={() => handleSaveDeal()}
                      className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:border-amber-400 transition-all [color-scheme:light]"
                    />
                    {editingDeal.follow_up_date && (
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        isOverdue(editingDeal.follow_up_date)
                          ? 'bg-red-50 text-red-600'
                          : 'bg-amber-50 text-amber-600'
                      }`}>
                        {formatDate(editingDeal.follow_up_date)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {[{ label: '+3d', days: 3 }, { label: '+1w', days: 7 }, { label: '+2w', days: 14 }, { label: '+1mo', days: 30 }].map((q) => (
                      <button
                        key={q.days}
                        onClick={() => {
                          const d = new Date()
                          d.setDate(d.getDate() + q.days)
                          const ds = d.toISOString().split('T')[0]
                          setEditingDeal((p) => p ? { ...p, follow_up_date: ds } : null)
                          handleSaveDeal({ follow_up_date: ds } as Partial<Deal>)
                        }}
                        className="px-3 py-1 text-xs border border-gray-200 rounded-md text-gray-500 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest pb-3 border-b border-gray-100 w-full">Notes</div>
                    {lastSaved && <span className="text-xs text-gray-400">Saved {lastSaved}</span>}
                  </div>
                  <textarea
                    value={editingDeal.notes ?? ''}
                    onChange={(e) => setEditingDeal((p) => p ? { ...p, notes: e.target.value } : null)}
                    onBlur={() => handleSaveDeal()}
                    placeholder="Add notes about this lead..."
                    rows={5}
                    className="w-full text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 focus:bg-white transition-all resize-none leading-relaxed"
                  />
                </div>
              </>
            )}
          </div>

          <aside className="w-72 shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
            {selected ? (
              <>
                <div className="p-4 border-b border-gray-100">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Quick Actions</div>
                  <div className="space-y-2">
                    <button
                      onClick={() => handleLogContact('Called — spoke')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-gray-50 hover:bg-amber-50 hover:text-amber-700 border border-gray-200 hover:border-amber-200 rounded-lg transition-colors font-medium"
                    >
                      <Phone size={14} />Log a call
                    </button>
                    <button
                      onClick={() => handleLogContact('Sent letter')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-gray-50 hover:bg-amber-50 hover:text-amber-700 border border-gray-200 hover:border-amber-200 rounded-lg transition-colors font-medium"
                    >
                      <Mail size={14} />Log mail sent
                    </button>
                    <button
                      onClick={() => handleLogContact('Left voicemail')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-gray-50 hover:bg-amber-50 hover:text-amber-700 border border-gray-200 hover:border-amber-200 rounded-lg transition-colors font-medium"
                    >
                      <Phone size={14} />Left voicemail
                    </button>
                  </div>
                </div>

                <div className="p-4 border-b border-gray-100">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Lead Score</div>
                  <div className="flex items-center gap-3">
                    <div className={`text-3xl font-bold font-serif ${
                      (selected.propensity_score ?? 0) >= 8 ? 'text-red-600' :
                      (selected.propensity_score ?? 0) >= 6 ? 'text-amber-600' : 'text-gray-500'
                    }`}>
                      {selected.propensity_score ?? 0}
                      <span className="text-lg text-gray-400 font-normal">/10</span>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-700">
                        {(selected.propensity_score ?? 0) >= 8 ? 'Hot lead' :
                         (selected.propensity_score ?? 0) >= 6 ? 'Warm lead' : 'Low priority'}
                      </div>
                      <div className="text-xs text-gray-400">Source: {selected.source ?? 'map'}</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        (selected.propensity_score ?? 0) >= 8 ? 'bg-red-500' :
                        (selected.propensity_score ?? 0) >= 6 ? 'bg-amber-400' : 'bg-gray-300'
                      }`}
                      style={{ width: `${((selected.propensity_score ?? 0) / 10) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="p-4 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Tasks</div>
                    <button
                      onClick={() => {
                        const task = prompt('Add task:')
                        if (task) {
                          setTasks((prev) => [...prev, { id: Date.now().toString(), text: task, done: false, dealId: selected.id }])
                        }
                      }}
                      className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                    >
                      + Add
                    </button>
                  </div>
                  {tasks.filter((t) => t.dealId === selected.id).length === 0 ? (
                    <div className="text-xs text-gray-400 italic">No tasks yet</div>
                  ) : (
                    <div className="space-y-2">
                      {tasks.filter((t) => t.dealId === selected.id).map((task) => (
                        <div key={task.id} className="flex items-start gap-2">
                          <button
                            onClick={() => setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, done: !t.done } : t))}
                            className="mt-0.5 shrink-0"
                          >
                            {task.done
                              ? <CheckCircle2 size={15} className="text-emerald-500" />
                              : <Circle size={15} className="text-gray-300 hover:text-amber-400" />
                            }
                          </button>
                          <span className={`text-sm leading-tight ${task.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                            {task.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Activity</div>
                  {contactLog.length === 0 ? (
                    <div className="text-xs text-gray-400 italic">No activity yet</div>
                  ) : (
                    <div className="space-y-3">
                      {contactLog.slice(0, 8).map((entry, i) => (
                        <div key={entry.id ?? `${entry.logged_at}-${i}`} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-2 h-2 rounded-full bg-amber-400 mt-1 shrink-0" />
                            {i < contactLog.slice(0, 8).length - 1 && <div className="w-px flex-1 bg-gray-100 mt-1" />}
                          </div>
                          <div className="pb-3">
                            <div className="text-sm text-gray-700 leading-tight">{entry.method}</div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {new Date(entry.logged_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="p-6 text-center text-sm text-gray-400 italic mt-8">
                Select a lead to see tasks and activity
              </div>
            )}
          </aside>
        </main>
      </div>
    </div>
  )
}
