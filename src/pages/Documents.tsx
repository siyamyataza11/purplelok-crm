import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { DocumentItem, Client } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate, cn } from '@/lib/utils';
import { Plus, FolderOpen, File, FileText, Image, Video, Upload, Search, Download } from 'lucide-react';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  file: <File size={18} />,
  folder: <FolderOpen size={18} />,
  contract: <FileText size={18} />,
  invoice: <FileText size={18} />,
  quote: <FileText size={18} />,
  logo: <Image size={18} />,
  image: <Image size={18} />,
  video: <Video size={18} />,
  template: <File size={18} />,
};

export function DocumentsPage() {
  const { profile } = useAuth();
  const { add } = useToast();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  async function load() {
    setLoading(true);
    const [dRes, cRes] = await Promise.all([
      supabase.from('documents').select('*, client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('company_name'),
    ]);
    setDocuments((dRes.data as DocumentItem[]) ?? []);
    setClients((cRes.data as Client[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => documents.filter((d) => {
    const matchesSearch = !search || d.name.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || d.type === typeFilter;
    return matchesSearch && matchesType;
  }), [documents, search, typeFilter]);

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-sm text-white/40 mt-0.5">{documents.length} files</p>
        </div>
        <Button onClick={() => setShowModal(true)}><Plus size={16} /> Add Document</Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search documents..." className="input-field pl-10" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-field w-auto">
          <option value="all">All Types</option>
          <option value="file">File</option>
          <option value="folder">Folder</option>
          <option value="contract">Contract</option>
          <option value="invoice">Invoice</option>
          <option value="quote">Quote</option>
          <option value="logo">Logo</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="template">Template</option>
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-32 bg-white/5 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<FolderOpen size={28} />} title="No documents" action={<Button onClick={() => setShowModal(true)}><Plus size={16} /> Add Document</Button>} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filtered.map((doc) => (
            <Card key={doc.id} hover className="p-4 group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-purple/10 flex items-center justify-center text-purple-light">{TYPE_ICONS[doc.type] || <File size={18} />}</div>
                <Badge variant="neutral">{doc.type}</Badge>
              </div>
              <p className="text-sm font-medium text-white truncate">{doc.name}</p>
              <p className="text-xs text-white/30 mt-1">{doc.client?.company_name || 'No client'}</p>
              <p className="text-xs text-white/30">{formatDate(doc.created_at)}</p>
              {doc.file_url && (
                <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-1 text-xs text-purple-light hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                  <Download size={12} /> Download
                </a>
              )}
            </Card>
          ))}
        </div>
      )}

      <DocumentModal open={showModal} onClose={() => setShowModal(false)} clients={clients} onSaved={() => { setShowModal(false); load(); }} />
    </div>
  );
}

function DocumentModal({ open, onClose, clients, onSaved }: { open: boolean; onClose: () => void; clients: Client[]; onSaved: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [form, setForm] = useState<Partial<DocumentItem>>({ type: 'file' });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase.from('documents').insert({
        name: form.name,
        type: form.type || 'file',
        client_id: form.client_id || null,
        file_url: form.file_url,
        mime_type: form.mime_type,
        uploaded_by: profile?.id,
      });
      if (error) throw error;
      add('success', 'Document added');
      onSaved();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Document"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.name}>Add Document</Button></>}>
      <div className="space-y-4">
        <Input label="Name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Type" value={form.type || 'file'} onChange={(e) => setForm({ ...form, type: e.target.value as DocumentItem['type'] })}>
            <option value="file">File</option>
            <option value="folder">Folder</option>
            <option value="contract">Contract</option>
            <option value="invoice">Invoice</option>
            <option value="quote">Quote</option>
            <option value="logo">Logo</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="template">Template</option>
          </Select>
          <Select label="Client" value={form.client_id || ''} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
        </div>
        <Input label="File URL" value={form.file_url || ''} onChange={(e) => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." />
        <Input label="MIME Type" value={form.mime_type || ''} onChange={(e) => setForm({ ...form, mime_type: e.target.value })} placeholder="application/pdf" />
      </div>
    </Modal>
  );
}
