import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useTenantData } from '@/context/TenantDataContext';
import { isTenantRealtimeMessage } from '@/lib/tenant-domain-workflows';
import { useToast } from '@/components/ui/Toast';
import type { Channel, ChatMessage } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { timeAgo, cn } from '@/lib/utils';
import { Plus, Send, Hash, MessageSquare } from 'lucide-react';

export function ChatPage() {
  const { profile } = useAuth();
  const { currentOrganization } = useOrganization();
  const tenant = useTenantData();
  const { add } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Array<{ user_id: string; full_name: string; avatar_url: string | null }>>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const msgEndRef = useRef<HTMLDivElement>(null);

  const activeChannelRef = useRef<string | null>(null);
  activeChannelRef.current = activeChannel?.id ?? null;
  const organizationId = currentOrganization?.id ?? null;
  const requestScopeRef = useRef({
    organizationId,
    userId: profile?.id ?? null,
    tenant,
    generation: 0,
  });
  if (
    requestScopeRef.current.organizationId !== organizationId
    || requestScopeRef.current.userId !== (profile?.id ?? null)
    || requestScopeRef.current.tenant !== tenant
  ) {
    requestScopeRef.current = {
      organizationId,
      userId: profile?.id ?? null,
      tenant,
      generation: requestScopeRef.current.generation + 1,
    };
  }

  const captureRequest = useCallback((channelId: string | null = null) => ({
    generation: requestScopeRef.current.generation,
    organizationId: requestScopeRef.current.organizationId,
    userId: requestScopeRef.current.userId,
    channelId,
  }), []);

  const isCurrentRequest = useCallback((request: ReturnType<typeof captureRequest>) => (
    requestScopeRef.current.generation === request.generation
    && requestScopeRef.current.organizationId === request.organizationId
    && requestScopeRef.current.userId === request.userId
    && (request.channelId === null || activeChannelRef.current === request.channelId)
  ), []);

  const loadMessages = useCallback(async (channelId: string) => {
    const request = captureRequest(channelId);
    if (!request.organizationId) {
      setMessages([]);
      return;
    }
    try {
      await tenant.assertTenantRecord('channels', channelId);
      const rows = await tenant.table('messages').select<ChatMessage>('*', {
        filters: [{ operator: 'eq', column: 'channel_id', value: channelId }],
        order: [{ column: 'created_at' }],
      });
      if (!isCurrentRequest(request)) return;
      setMessages(rows);
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (error) {
      if (isCurrentRequest(request)) setMessages([]);
      throw error;
    }
  }, [captureRequest, isCurrentRequest, tenant]);

  const loadChannels = useCallback(async () => {
    const request = captureRequest();
    setChannels([]);
    setMembers([]);
    setMessages([]);
    setActiveChannel(null);
    setNewMsg('');
    setChannelName('');
    setShowNewChannel(false);
    if (
      !organizationId
      || !profile?.id
      || request.organizationId !== organizationId
      || request.userId !== profile.id
    ) return;
    try {
      const [channelRows, memberRows] = await Promise.all([
        tenant.table('channels').select<Channel>('*', { order: [{ column: 'created_at' }] }),
        tenant.members.listActive(),
      ]);
      if (!isCurrentRequest(request)) return;
      setChannels(channelRows);
      setMembers(memberRows);
      setActiveChannel(channelRows[0] ?? null);
    } catch (error) {
      if (isCurrentRequest(request)) {
        setChannels([]);
        setMembers([]);
        setMessages([]);
        setActiveChannel(null);
      }
      throw error;
    }
  }, [captureRequest, isCurrentRequest, organizationId, profile?.id, tenant]);

  useEffect(() => {
    if (!activeChannel) {
      setMessages([]);
      return;
    }
    const channelId = activeChannel.id;
    void loadMessages(channelId).catch(() => undefined);
  }, [activeChannel, loadMessages]);

  useEffect(() => {
    void loadChannels().catch(() => undefined);
  }, [loadChannels]);

  useEffect(() => {
    if (!organizationId || !profile?.id) return;
    let disposed = false;
    const sub = supabase
      .channel(`messages:${organizationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `organization_id=eq.${organizationId}`,
      }, (payload) => {
        const channelId = activeChannelRef.current;
        if (disposed || !channelId || !isTenantRealtimeMessage(payload, organizationId, channelId)) return;
        void loadMessages(channelId).catch(() => undefined);
      })
      .subscribe();
    return () => {
      disposed = true;
      void supabase.removeChannel(sub);
      setMessages([]);
    };
  }, [organizationId, loadMessages, profile?.id]);

  async function sendMsg() {
    if (!newMsg.trim() || !activeChannel) return;
    const request = captureRequest(activeChannel.id);
    try {
      if (!request.userId) throw new Error('An authenticated sender is required');
      if (!request.organizationId) throw new Error('An active organization is required');
      const senderId = request.userId;
      const channelId = request.channelId as string;
      await tenant.members.assertActive(senderId);
      await tenant.assertTenantRecord('channels', channelId);
      await tenant.table('messages').insert({
        channel_id: channelId,
        author_id: senderId,
        body: newMsg,
      });
      if (!isCurrentRequest(request)) return;
      setNewMsg('');
      await loadMessages(channelId);
    } catch (error) {
      if (!isCurrentRequest(request)) return;
      add('error', (error as Error).message);
    }
  }

  async function createChannel() {
    if (!channelName.trim()) return;
    const request = captureRequest();
    try {
      if (!request.userId) throw new Error('An authenticated creator is required');
      if (!request.organizationId) throw new Error('An active organization is required');
      const creatorId = request.userId;
      await tenant.members.assertActive(creatorId);
      const [data] = await tenant.table('channels').insert({
        name: channelName,
        created_by: creatorId,
      }, { returning: '*' });
      if (!isCurrentRequest(request)) return;
      setChannels((prev) => [...prev, data as Channel]);
      setActiveChannel(data as Channel);
      setChannelName('');
      setShowNewChannel(false);
      add('success', 'Channel created');
    } catch (error) {
      if (!isCurrentRequest(request)) return;
      add('error', (error as Error).message);
    }
  }

  return (
    <div className="p-6 animate-fade-in max-w-[1400px] mx-auto h-[calc(100vh-4rem)] flex gap-4">
      {/* Channels sidebar */}
      <div className="w-64 shrink-0 space-y-2">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold">Team Chat</h1>
          <Button variant="ghost" size="icon" onClick={() => setShowNewChannel(!showNewChannel)}><Plus size={16} /></Button>
        </div>
        {showNewChannel && (
          <div className="flex gap-2 mb-2">
            <Input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="Channel name" onKeyDown={(e) => e.key === 'Enter' && createChannel()} />
            <Button size="sm" onClick={createChannel}>Add</Button>
          </div>
        )}
        <div className="space-y-1">
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveChannel(c)}
              className={cn('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors', activeChannel?.id === c.id ? 'bg-purple-50 text-primary' : 'text-secondary hover:text-primary hover:bg-muted')}
            >
              <Hash size={14} /> {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {activeChannel ? (
          <>
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <Hash size={16} className="text-tertiary" />
              <h2 className="text-sm font-semibold">{activeChannel.name}</h2>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 py-4">
              {messages.length === 0 ? (
                <EmptyState icon={<MessageSquare size={24} />} title="No messages yet" description="Start the conversation" />
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="flex gap-3 px-4">
                    <Avatar name={members.find((member) => member.user_id === m.author_id)?.full_name} src={members.find((member) => member.user_id === m.author_id)?.avatar_url ?? undefined} size="sm" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-primary">{members.find((member) => member.user_id === m.author_id)?.full_name || 'Unknown'}</p>
                        <span className="text-xs text-tertiary">{timeAgo(m.created_at)}</span>
                      </div>
                      <p className="text-sm text-secondary mt-0.5">{m.body}</p>
                    </div>
                  </div>
                ))
              )}
              <div ref={msgEndRef} />
            </div>
            <div className="p-4 border-t border-line">
              <div className="flex gap-2">
                <input
                  value={newMsg}
                  onChange={(e) => setNewMsg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
                  placeholder={`Message #${activeChannel.name}`}
                  className="input-field"
                />
                <Button onClick={sendMsg} size="icon"><Send size={16} /></Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon={<MessageSquare size={28} />} title="Select a channel" />
          </div>
        )}
      </div>
    </div>
  );
}
