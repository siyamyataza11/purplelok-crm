import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Quote, QuoteItem, Client, Invoice, Project } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate, generateNumber, cn } from '@/lib/utils';
import { Plus, FileText, Trash2, ArrowLeft, Receipt, Briefcase, Copy, Send, Check, X } from 'lucide-react';

type View = 'list' | 'detail' | 'create';

export function QuotesPage() {
  const { add } = useToast();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [selected, setSelected] = useState<Quote | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  async function load() {
    setLoading(true);
    const [qRes, cRes] = await Promise.all([
      supabase.from('quotes').select('*, client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('company_name'),
    ]);
    setQuotes((qRes.data as Quote[]) ?? []);
    setClients((cRes.data as Client[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return quotes.filter((q) => statusFilter === 'all' || q.status === statusFilter);
  }, [quotes, statusFilter]);

  async function convertToInvoice(q: Quote) {
    const invoiceNumber = generateNumber('INV');
    const { data, error } = await supabase.from('invoices').insert({
      invoice_number: invoiceNumber,
      client_id: q.client_id,
      quote_id: q.id,
      title: q.title,
      status: 'draft',
      subtotal: q.subtotal,
      discount: q.discount,
      vat: q.vat,
      total: q.total,
      vat_rate: q.vat_rate,
      balance: q.total,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    }).select().single();
    if (error) { add('error', error.message); return; }
    const invoice = data as Invoice;
    // Copy items
    const { data: items } = await supabase.from('quote_items').select('*').eq('quote_id', q.id);
    if (items) {
      await supabase.from('invoice_items').insert(
        items.map((i) => ({ invoice_id: invoice.id, description: i.description, quantity: i.quantity, unit_price: i.unit_price, total: i.total }))
      );
    }
    add('success', `Invoice ${invoiceNumber} created from quote`);
  }

  async function convertToProject(q: Quote) {
    const { error } = await supabase.from('projects').insert({
      name: q.title,
      client_id: q.client_id,
      type: 'other',
      status: 'planning',
      budget: q.total,
      progress: 0,
      health: 'on_track',
    });
    if (error) { add('error', error.message); return; }
    add('success', 'Project created from quote');
    await supabase.from('quotes').update({ status: 'accepted' }).eq('id', q.id);
    load();
  }

  async function duplicateQuote(q: Quote) {
    const newNum = generateNumber('QUO');
    const { data, error } = await supabase.from('quotes').insert({
      quote_number: newNum,
      client_id: q.client_id,
      title: `${q.title} (Copy)`,
      status: 'draft',
      subtotal: q.subtotal,
      discount: q.discount,
      vat: q.vat,
      total: q.total,
      vat_rate: q.vat_rate,
      terms: q.terms,
    }).select().single();
    if (error) { add('error', error.message); return; }
    const { data: items } = await supabase.from('quote_items').select('*').eq('quote_id', q.id);
    if (items && items.length > 0) {
      await supabase.from('quote_items').insert(items.map((i) => ({ quote_id: (data as Quote).id, description: i.description, quantity: i.quantity, unit_price: i.unit_price, total: i.total })));
    }
    add('success', 'Quote duplicated');
    load();
  }

  async function sendQuote(q: Quote) {
    await supabase.from('quotes').update({ status: 'sent' }).eq('id', q.id);
    add('success', 'Quote marked as sent');
    load();
  }

  async function acceptQuote(q: Quote) {
    await supabase.from('quotes').update({ status: 'accepted', approved_by_client: true, approved_at: new Date().toISOString() }).eq('id', q.id);
    add('success', 'Quote accepted');
    load();
  }

  if (view === 'detail' && selected) {
    return <QuoteDetail quote={selected} onBack={() => { setView('list'); setSelected(null); }} onUpdated={load} onConvertInvoice={convertToInvoice} onConvertProject={convertToProject} onDuplicate={duplicateQuote} onSend={sendQuote} onAccept={acceptQuote} />;
  }

  if (view === 'create') {
    return <QuoteCreate clients={clients} onBack={() => setView('list')} onCreated={() => { setView('list'); load(); }} />;
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotations</h1>
          <p className="text-sm text-tertiary mt-0.5">{quotes.length} total quotes</p>
        </div>
        <Button onClick={() => setView('create')}><Plus size={16} /> New Quote</Button>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field w-auto">
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<FileText size={28} />} title="No quotes yet" description="Create your first quotation" action={<Button onClick={() => setView('create')}><Plus size={16} /> New Quote</Button>} />
      ) : (
        <Card>
          <div className="divide-y divide-line">
            {filtered.map((q) => (
              <div key={q.id} className="flex items-center justify-between p-4 hover:bg-muted cursor-pointer" onClick={() => { setSelected(q); setView('detail'); }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
                    <FileText size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-primary">{q.quote_number}</p>
                    <p className="text-xs text-tertiary">{q.title} · {q.client?.company_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge variant={q.status === 'accepted' ? 'success' : q.status === 'sent' ? 'info' : q.status === 'rejected' ? 'danger' : 'neutral'}>{q.status}</Badge>
                  <p className="text-sm font-semibold w-28 text-right">{formatCurrency(q.total)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function QuoteCreate({ clients, onBack, onCreated }: { clients: Client[]; onBack: () => void; onCreated: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<Partial<QuoteItem>[]>([{ description: '', quantity: 1, unit_price: 0, total: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [vatRate, setVatRate] = useState(15);
  const [validUntil, setValidUntil] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [terms, setTerms] = useState('Payment due within 14 days of acceptance.\n50% deposit required to commence work.\nPrices valid for 30 days.');
  const [saving, setSaving] = useState(false);

  function updateItem(idx: number, field: keyof QuoteItem, value: string | number) {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: value };
      const qty = Number(updated.quantity) || 0;
      const price = Number(updated.unit_price) || 0;
      updated.total = qty * price;
      return updated;
    }));
  }

  function addItem() { setItems([...items, { description: '', quantity: 1, unit_price: 0, total: 0 }]); }
  function removeItem(idx: number) { setItems(items.filter((_, i) => i !== idx)); }

  const subtotal = items.reduce((sum, i) => sum + (Number(i.total) || 0), 0);
  const afterDiscount = Math.max(0, subtotal - discount);
  const vat = afterDiscount * (vatRate / 100);
  const total = afterDiscount + vat;

  async function handleSave() {
    if (!clientId || !title) { add('error', 'Please select a client and add a title'); return; }
    setSaving(true);
    try {
      const quoteNumber = generateNumber('QUO');
      const { data, error } = await supabase.from('quotes').insert({
        quote_number: quoteNumber,
        client_id: clientId,
        title,
        status: 'draft',
        subtotal,
        discount,
        vat,
        total,
        vat_rate: vatRate,
        terms,
        valid_until: validUntil,
        created_by: profile?.id,
      }).select().single();
      if (error) throw error;
      const quote = data as Quote;
      if (items.length > 0) {
        await supabase.from('quote_items').insert(items.map((i) => ({ quote_id: quote.id, description: i.description, quantity: i.quantity, unit_price: i.unit_price, total: i.total })));
      }
      await supabase.from('activities').insert({ user_id: profile?.id, type: 'quote_created', entity: 'quote', entity_id: quote.id, description: `created quote ${quoteNumber} for ${clients.find(c => c.id === clientId)?.company_name}` });
      add('success', 'Quote created');
      onCreated();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1000px] mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-tertiary hover:text-primary"><ArrowLeft size={16} /> Back to Quotes</button>
      <h1 className="text-2xl font-bold tracking-tight">New Quotation</h1>

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select a client...</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Website design and development" />
          <Input label="Valid Until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          <Input label="VAT Rate (%)" type="number" value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} />
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Line Items</h3>
          <Button variant="subtle" size="sm" onClick={addItem}><Plus size={14} /> Add Item</Button>
        </div>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-5">
                <Input label={idx === 0 ? "Description" : undefined} value={item.description || ''} onChange={(e) => updateItem(idx, 'description', e.target.value)} placeholder="Service or product" />
              </div>
              <div className="col-span-2">
                <Input label={idx === 0 ? "Qty" : undefined} type="number" value={item.quantity || 1} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))} />
              </div>
              <div className="col-span-2">
                <Input label={idx === 0 ? "Unit Price" : undefined} type="number" value={item.unit_price || 0} onChange={(e) => updateItem(idx, 'unit_price', Number(e.target.value))} />
              </div>
              <div className="col-span-2">
                <div className={cn('text-sm', idx === 0 && 'mt-6')}>
                  <p className="text-sm font-semibold text-primary">{formatCurrency(Number(item.total) || 0)}</p>
                </div>
              </div>
              <div className="col-span-1">
                {items.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}><Trash2 size={14} /></Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-6">
          <Textarea label="Terms & Conditions" rows={5} value={terms} onChange={(e) => setTerms(e.target.value)} />
          <div className="space-y-3">
            <div className="flex justify-between text-sm"><span className="text-tertiary">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between text-sm items-center">
              <span className="text-tertiary">Discount</span>
              <input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="input-field w-32 text-right" />
            </div>
            <div className="flex justify-between text-sm"><span className="text-tertiary">VAT ({vatRate}%)</span><span>{formatCurrency(vat)}</span></div>
            <div className="flex justify-between text-base font-bold pt-3 border-t border-line"><span>Total</span><span className="text-purple-600">{formatCurrency(total)}</span></div>
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onBack}>Cancel</Button>
        <Button onClick={handleSave} loading={saving} disabled={!clientId || !title}>Create Quote</Button>
      </div>
    </div>
  );
}

function QuoteDetail({ quote, onBack, onUpdated, onConvertInvoice, onConvertProject, onDuplicate, onSend, onAccept }: {
  quote: Quote;
  onBack: () => void;
  onUpdated: () => void;
  onConvertInvoice: (q: Quote) => void;
  onConvertProject: (q: Quote) => void;
  onDuplicate: (q: Quote) => void;
  onSend: (q: Quote) => void;
  onAccept: (q: Quote) => void;
}) {
  const [items, setItems] = useState<QuoteItem[]>([]);
  const { add } = useToast();

  useEffect(() => {
    async function loadItems() {
      const { data } = await supabase.from('quote_items').select('*').eq('quote_id', quote.id).order('created_at');
      setItems((data as QuoteItem[]) ?? []);
    }
    loadItems();
  }, [quote.id]);

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1000px] mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-tertiary hover:text-primary"><ArrowLeft size={16} /> Back to Quotes</button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{quote.quote_number}</h1>
          <p className="text-sm text-tertiary">{quote.title}</p>
        </div>
        <Badge variant={quote.status === 'accepted' ? 'success' : quote.status === 'sent' ? 'info' : 'neutral'} dot>{quote.status}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {quote.status === 'draft' && <Button onClick={() => onSend(quote)}><Send size={14} /> Send Quote</Button>}
        {quote.status === 'sent' && <Button onClick={() => onAccept(quote)} variant="subtle"><Check size={14} /> Mark Accepted</Button>}
        <Button variant="outline" onClick={() => onConvertInvoice(quote)}><Receipt size={14} /> Convert to Invoice</Button>
        <Button variant="outline" onClick={() => onConvertProject(quote)}><Briefcase size={14} /> Convert to Project</Button>
        <Button variant="ghost" onClick={() => onDuplicate(quote)}><Copy size={14} /> Duplicate</Button>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-xs text-tertiary mb-1">Client</p>
            <p className="text-sm font-medium text-primary">{quote.client?.company_name}</p>
            <p className="text-xs text-tertiary">{quote.client?.email}</p>
          </div>
          <div>
            <p className="text-xs text-tertiary mb-1">Valid Until</p>
            <p className="text-sm text-primary">{formatDate(quote.valid_until)}</p>
          </div>
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className="text-left text-xs text-tertiary font-medium pb-2">Description</th>
              <th className="text-right text-xs text-tertiary font-medium pb-2">Qty</th>
              <th className="text-right text-xs text-tertiary font-medium pb-2">Unit Price</th>
              <th className="text-right text-xs text-tertiary font-medium pb-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-line/50">
                <td className="py-3 text-sm text-primary">{item.description}</td>
                <td className="py-3 text-sm text-secondary text-right">{item.quantity}</td>
                <td className="py-3 text-sm text-secondary text-right">{formatCurrency(item.unit_price)}</td>
                <td className="py-3 text-sm text-primary text-right font-medium">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mt-6">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-tertiary">Subtotal</span><span>{formatCurrency(quote.subtotal)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-tertiary">Discount</span><span>-{formatCurrency(quote.discount)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-tertiary">VAT ({quote.vat_rate}%)</span><span>{formatCurrency(quote.vat)}</span></div>
            <div className="flex justify-between text-base font-bold pt-2 border-t border-line"><span>Total</span><span className="text-purple-600">{formatCurrency(quote.total)}</span></div>
          </div>
        </div>

        {quote.terms && (
          <div className="mt-6 pt-4 border-t border-line">
            <p className="text-xs text-tertiary mb-2">Terms & Conditions</p>
            <p className="text-sm text-secondary whitespace-pre-line">{quote.terms}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
