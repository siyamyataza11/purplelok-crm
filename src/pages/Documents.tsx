import { useState, useEffect, useMemo, useRef } from 'react';
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
import { formatDate, cn, formatBytes } from '@/lib/utils';
import { Plus, FolderOpen, File, FileText, Image, Video, Upload, Search, Download, Loader2 } from 'lucide-react';

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

function inferTypeFromMime(mime: string): DocumentItem['type'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'contract';
  return 'file';
}

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

  async function getSignedUrl(doc: DocumentItem) {
    if (!doc.file_url) return;
    try {
      const filePath = doc.file_url.replace(/^documents\//, '');
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(filePath, 3600);
      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (err) {
      add('error', 'Could not open file: ' + (err as Error).message);
    }
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-sm text-tertiary mt-0.5">{documents.length} files</p>
        </div>
        <Button onClick={() => setShowModal(true)}><Plus size={16} /> Add Document</Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<FolderOpen size={28} />} title="No documents" action={<Button onClick={() => setShowModal(true)}><Plus size={16} /> Add Document</Button>} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filtered.map((doc) => (
            <Card key={doc.id} hover className="p-4 group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">{TYPE_ICONS[doc.type] || <File size={18} />}</div>
                <Badge variant="neutral">{doc.type}</Badge>
              </div>
              <p className="text-sm font-medium text-primary truncate">{doc.name}</p>
              <p className="text-xs text-tertiary mt-1">{doc.client?.company_name || 'No client'}</p>
              <p className="text-xs text-tertiary">{formatDate(doc.created_at)}</p>
              {doc.file_size != null && <p className="text-xs text-tertiary">{formatBytes(doc.file_size)}</p>}
              {doc.file_url && (
                <button onClick={() => getSignedUrl(doc)} className="mt-2 flex items-center gap-1 text-xs text-purple-600 hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                  <Download size={12} /> Download
                </button>
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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(file: File) {
    setUploading(true);
    setUploadProgress(0);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      setForm((prev) => ({
        ...prev,
        name: prev.name || file.name,
        file_url: filePath,
        mime_type: file.type,
        file_size: file.size,
        type: prev.type && prev.type !== 'file' ? prev.type : inferTypeFromMime(file.type),
      }));
      add('success', 'File uploaded');
    } catch (err) {
      add('error', 'Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }

  async function handleSave() {
    if (!form.name) { add('error', 'Name is required'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('documents').insert({
        name: form.name,
        type: form.type || 'file',
        client_id: form.client_id || null,
        file_url: form.file_url,
        file_size: form.file_size || null,
        mime_type: form.mime_type,
        uploaded_by: profile?.id,
      });
      if (error) throw error;
      add('success', 'Document added');
      onSaved();
      setForm({ type: 'file' });
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Document"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.name || uploading}>Add Document</Button></>}>
      <div className="space-y-4">
        {/* Upload area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            dragOver ? 'border-purple-400 bg-purple-50' : 'border-line hover:border-purple-200 hover:bg-muted'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={24} className="text-purple-600 animate-spin" />
              <p className="text-sm text-secondary">Uploading... {uploadProgress}%</p>
            </div>
          ) : form.file_url ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
                <File size={20} />
              </div>
              <p className="text-sm font-medium text-primary">{form.name}</p>
              <p className="text-xs text-tertiary">{form.file_size ? formatBytes(form.file_size) : ''} · Click to replace</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={24} className="text-tertiary" />
              <p className="text-sm text-secondary">Drag & drop a file here, or click to browse</p>
              <p className="text-xs text-tertiary">PDF, images, videos, documents up to 50MB</p>
            </div>
          )}
        </div>

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
      </div>
    </Modal>
  );
}
