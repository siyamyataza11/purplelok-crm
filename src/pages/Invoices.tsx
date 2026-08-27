import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Invoice, InvoiceItem, Client, Payment } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate, generateNumber, cn, isOverdue } from '@/lib/utils';
import { Plus, Receipt, Trash2, ArrowLeft, DollarSign, Send, Clock, AlertCircle } from 'lucide-react';

type View = 'list' | 'detail' | 'create';

export function InvoicesPage() {
  const { add } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showPayment, setShowPayment] = useState(false);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);

  async function load() {
    setLoading(true);
    const [iRes, cRes] = await Promise.all([
      supabase.from('invoices').select('*, client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('company_name'),
    ]);
    setInvoices((iRes.data as Invoice[]) ?? []);
    setClients((cRes.data as Client[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Auto-flag overdue
  useEffect(() => {
    if (invoices.length === 0) return;
    invoices.forEach(async (inv) => {
      if (inv.status === 'sent' && inv.due_date && isOverdue(inv.due_date)) {
        await supabase.from('invoices').update({ status: 'overdue' }).eq('id', inv.id);
      }
    });
  }, [invoices]);

  const filtered = useMemo(() => invoices.filter((i) => statusFilter === 'all' || i.status === statusFilter), [invoices, statusFilter]);

  const totalOutstanding = invoices
    .filter((i) => i.status === 'sent' || i.status === 'partial' || i.status === 'overdue')
    .reduce((s, i) => s + i.balance, 0);
  const totalPaid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const totalOverdue = invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.balance, 0);

  async function recordPayment(inv: Invoice, amount: number, method: string, reference: string) {
    const { error } = await supabase.from('payments').insert({
      invoice_id: inv.id,
      client_id: inv.client_id,
      amount,
      method,
      reference,
    });
    if (error) { add('error', error.message); return; }
    const newPaid = inv.amount_paid + amount;
    const newBalance = inv.total - newPaid;
    const newStatus = newBalance <= 0 ? 'paid' : 'partial';
    await supabase.from('invoices').update({ amount_paid: newPaid, balance: newBalance, status: newStatus }).eq('id', inv.id);
    add('success', `Payment of ${formatCurrency(amount)} recorded`);
    setShowPayment(false);
    setPayInvoice(null);
    load();
  }

  async function sendInvoice(inv: Invoice) {
    await supabase.from('invoices').update({ status: 'sent' }).eq('id', inv.id);
    add('success', 'Invoice sent to client');
    load();
  }

  if (view === 'detail' && selected) {
    return <InvoiceDetail invoice={selected} onBack={() => { setView('list'); setSelected(null); }} onPay={() => { setPayInvoice(selected); setShowPayment(true); }} onSend={sendInvoice} onUpdated={load} />;
  }

  if (view === 'create') {
    return <InvoiceCreate clients={clients} onBack={() => setView('list')} onCreated={() => { setView('list'); load(); }} />;
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-tertiary mt-0.5">{invoices.length} total invoices</p>
        </div>
        <Button onClick={() => setView('create')}><Plus size={16} /> New Invoice</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center text-green-600"><DollarSign size={18} /></div>
            <div><p className="text-xs text-tertiary">Total Paid</p><p className="text-xl font-bold">{formatCurrency(totalPaid)}</p></div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600"><Clock size={18} /></div>
            <div><p className="text-xs text-tertiary">Outstanding</p><p className="text-xl font-bold">{formatCurrency(totalOutstanding)}</p></div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-red-600"><AlertCircle size={18} /></div>
            <div><p className="text-xs text-tertiary">Overdue</p><p className="text-xl font-bold">{formatCurrency(totalOverdue)}</p></div>
          </div>
        </Card>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field w-auto">
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Receipt size={28} />} title="No invoices yet" action={<Button onClick={() => setView('create')}><Plus size={16} /> New Invoice</Button>} />
      ) : (
        <Card>
          <div className="divide-y divide-line">
            {filtered.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-4 hover:bg-muted cursor-pointer" onClick={() => { setSelected(inv); setView('detail'); }}>
                <div className="flex items-center gap-4">
                  <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center',
                    inv.status === 'paid' ? 'bg-green-50 text-green-600' :
                    inv.status === 'overdue' ? 'bg-red-50 text-red-600' :
                    'bg-purple-50 text-purple-600')}>
                    <Receipt size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-primary">{inv.invoice_number}</p>
                    <p className="text-xs text-tertiary">{inv.title} · {inv.client?.company_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-tertiary">Due {formatDate(inv.due_date)}</p>
                    {inv.balance > 0 && inv.status !== 'paid' && <p className="text-xs text-orange-600">Bal: {formatCurrency(inv.balance)}</p>}
                  </div>
                  <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : inv.status === 'partial' ? 'warning' : 'neutral'}>{inv.status}</Badge>
                  <p className="text-sm font-semibold w-28 text-right">{formatCurrency(inv.total)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showPayment && payInvoice && (
        <PaymentModal invoice={payInvoice} onClose={() => setShowPayment(false)} onPay={recordPayment} />
      )}
    </div>
  );
}

function PaymentModal({ invoice, onClose, onPay }: { invoice: Invoice; onClose: () => void; onPay: (inv: Invoice, amount: number, method: string, reference: string) => void }) {
  const [amount, setAmount] = useState(invoice.balance);
  const [method, setMethod] = useState('EFT');
  const [reference, setReference] = useState('');

  return (
    <Modal open onClose={onClose} title="Record Payment" description={`${invoice.invoice_number} · Balance: ${formatCurrency(invoice.balance)}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => onPay(invoice, amount, method, reference)} disabled={amount <= 0}>Record Payment</Button></>}>
      <div className="space-y-4">
        <Input label="Amount" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <Select label="Payment Method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="EFT">EFT / Bank Transfer</option>
          <option value="Card">Credit Card</option>
          <option value="Cash">Cash</option>
          <option value="PayFast">PayFast</option>
          <option value="Paystack">Paystack</option>
          <option value="Stripe">Stripe</option>
          <option value="PayPal">PayPal</option>
        </Select>
        <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Payment reference" />
      </div>
    </Modal>
  );
}

function InvoiceCreate({ clients, onBack, onCreated }: { clients: Client[]; onBack: () => void; onCreated: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<Partial<InvoiceItem>[]>([{ description: '', quantity: 1, unit_price: 0, total: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [vatRate, setVatRate] = useState(15);
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [recurring, setRecurring] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  function updateItem(idx: number, field: keyof InvoiceItem, value: string | number) {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: value };
      updated.total = (Number(updated.quantity) || 0) * (Number(updated.unit_price) || 0);
      return updated;
    }));
  }
  function addItem() { setItems([...items, { description: '', quantity: 1, unit_price: 0, total: 0 }]); }
  function removeItem(idx: number) { setItems(items.filter((_, i) => i !== idx)); }

  const subtotal = items.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const afterDiscount = Math.max(0, subtotal - discount);
  const vat = afterDiscount * (vatRate / 100);
  const total = afterDiscount + vat;

  async function handleSave() {
    if (!clientId || !title) { add('error', 'Select a client and add a title'); return; }
    setSaving(true);
    try {
      const invoiceNumber = generateNumber('INV');
      const { data, error } = await supabase.from('invoices').insert({
        invoice_number: invoiceNumber,
        client_id: clientId,
        title,
        status: 'draft',
        subtotal, discount, vat, total, vat_rate: vatRate,
        balance: total,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: dueDate,
        recurring,
        recurring_interval: recurring ? 'monthly' : null,
        notes,
        created_by: profile?.id,
      }).select().single();
      if (error) throw error;
      const inv = data as Invoice;
      if (items.length > 0) {
        await supabase.from('invoice_items').insert(items.map((i) => ({ invoice_id: inv.id, description: i.description, quantity: i.quantity, unit_price: i.unit_price, total: i.total })));
      }
      add('success', 'Invoice created');
      onCreated();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1000px] mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-tertiary hover:text-primary"><ArrowLeft size={16} /> Back to Invoices</button>
      <h1 className="text-2xl font-bold tracking-tight">New Invoice</h1>

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select a client...</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Website development" />
          <Input label="Due Date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <Input label="VAT Rate (%)" type="number" value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} />
        </div>
        <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="w-4 h-4 accent-purple" />
          Recurring invoice (monthly)
        </label>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Line Items</h3>
          <Button variant="subtle" size="sm" onClick={addItem}><Plus size={14} /> Add Item</Button>
        </div>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-5"><Input label={idx === 0 ? "Description" : undefined} value={item.description || ''} onChange={(e) => updateItem(idx, 'description', e.target.value)} placeholder="Service or product" /></div>
              <div className="col-span-2"><Input label={idx === 0 ? "Qty" : undefined} type="number" value={item.quantity || 1} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))} /></div>
              <div className="col-span-2"><Input label={idx === 0 ? "Unit Price" : undefined} type="number" value={item.unit_price || 0} onChange={(e) => updateItem(idx, 'unit_price', Number(e.target.value))} /></div>
              <div className="col-span-2"><div className={cn('text-sm', idx === 0 && 'mt-6')}><p className="text-sm font-semibold text-primary">{formatCurrency(Number(item.total) || 0)}</p></div></div>
              <div className="col-span-1">{items.length > 1 && <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}><Trash2 size={14} /></Button>}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-6">
          <Textarea label="Notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="space-y-3">
            <div className="flex justify-between text-sm"><span className="text-tertiary">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between text-sm items-center"><span className="text-tertiary">Discount</span><input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="input-field w-32 text-right" /></div>
            <div className="flex justify-between text-sm"><span className="text-tertiary">VAT ({vatRate}%)</span><span>{formatCurrency(vat)}</span></div>
            <div className="flex justify-between text-base font-bold pt-3 border-t border-line"><span>Total</span><span className="text-purple-600">{formatCurrency(total)}</span></div>
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onBack}>Cancel</Button>
        <Button onClick={handleSave} loading={saving} disabled={!clientId || !title}>Create Invoice</Button>
      </div>
    </div>
  );
}

function InvoiceDetail({ invoice, onBack, onPay, onSend, onUpdated }: {
  invoice: Invoice;
  onBack: () => void;
  onPay: () => void;
  onSend: (inv: Invoice) => void;
  onUpdated: () => void;
}) {
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    async function load() {
      const [iRes, pRes] = await Promise.all([
        supabase.from('invoice_items').select('*').eq('invoice_id', invoice.id),
        supabase.from('payments').select('*').eq('invoice_id', invoice.id).order('paid_at', { ascending: false }),
      ]);
      setItems((iRes.data as InvoiceItem[]) ?? []);
      setPayments((pRes.data as Payment[]) ?? []);
    }
    load();
  }, [invoice.id]);

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1000px] mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-tertiary hover:text-primary"><ArrowLeft size={16} /> Back to Invoices</button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{invoice.invoice_number}</h1>
          <p className="text-sm text-tertiary">{invoice.title}</p>
        </div>
        <Badge variant={invoice.status === 'paid' ? 'success' : invoice.status === 'overdue' ? 'danger' : 'warning'} dot>{invoice.status}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {invoice.status === 'draft' && <Button onClick={() => onSend(invoice)}><Send size={14} /> Send Invoice</Button>}
        {invoice.balance > 0 && invoice.status !== 'draft' && <Button onClick={onPay}><DollarSign size={14} /> Record Payment</Button>}
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-xs text-tertiary mb-1">Client</p>
            <p className="text-sm font-medium text-primary">{invoice.client?.company_name}</p>
            <p className="text-xs text-tertiary">{invoice.client?.email}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-tertiary mb-1">Due Date</p>
            <p className="text-sm text-primary">{formatDate(invoice.due_date)}</p>
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
            <div className="flex justify-between text-sm"><span className="text-tertiary">Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-tertiary">Discount</span><span>-{formatCurrency(invoice.discount)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-tertiary">VAT ({invoice.vat_rate}%)</span><span>{formatCurrency(invoice.vat)}</span></div>
            <div className="flex justify-between text-base font-bold pt-2 border-t border-line"><span>Total</span><span className="text-purple-600">{formatCurrency(invoice.total)}</span></div>
            {invoice.amount_paid > 0 && <div className="flex justify-between text-sm"><span className="text-green-600">Paid</span><span className="text-green-600">{formatCurrency(invoice.amount_paid)}</span></div>}
            {invoice.balance > 0 && <div className="flex justify-between text-sm"><span className="text-orange-600">Balance Due</span><span className="text-orange-600">{formatCurrency(invoice.balance)}</span></div>}
          </div>
        </div>
      </Card>

      {payments.length > 0 && (
        <Card className="p-6">
          <h3 className="text-sm font-semibold mb-4">Payment History</h3>
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div>
                  <p className="text-sm font-medium text-primary">{formatCurrency(p.amount)}</p>
                  <p className="text-xs text-tertiary">{p.method} · {p.reference || 'No ref'} · {formatDate(p.paid_at)}</p>
                </div>
                <Badge variant="success">Paid</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
