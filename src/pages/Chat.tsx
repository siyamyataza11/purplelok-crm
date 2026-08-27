import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Channel, ChatMessage, Profile } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { timeAgo, cn } from '@/lib/utils';
import { Plus, Send, Hash, MessageSquare } from 'lucide-react';

export function ChatPage() {
  const { profile } = useAuth();
  const { add } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const msgEndRef = useRef<HTMLDivElement>(null);

  async function loadChannels() {
    const { data } = await supabase.from('channels').select('*').order('created_at');
    const ch = (data as Channel[]) ?? [];
    setChannels(ch);
    if (ch.length > 0 && !activeChannel) setActiveChannel(ch[0]);
    setLoading(false);
  }

  useEffect(() => { loadChannels(); }, []);

  async function loadMessages(channelId: string) {
    const { data } = await supabase.from('messages').select('*, author:profiles(*)').eq('channel_id', channelId).order('created_at');
    setMessages((data as ChatMessage[]) ?? []);
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  useEffect(() => {
    if (activeChannel) loadMessages(activeChannel.id);
    const sub = supabase
      .channel('messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (activeChannel && (payload.new as ChatMessage).channel_id === activeChannel.id) {
          loadMessages(activeChannel.id);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [activeChannel?.id]);

  async function sendMsg() {
    if (!newMsg.trim() || !activeChannel) return;
    const { data, error } = await supabase.from('messages').insert({
      channel_id: activeChannel.id,
      author_id: profile?.id,
      body: newMsg,
    }).select('*, author:profiles(*)').single();
    if (error) { add('error', error.message); return; }
    setMessages((prev) => [...prev, data as ChatMessage]);
    setNewMsg('');
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  async function createChannel() {
    if (!channelName.trim()) return;
    const { data, error } = await supabase.from('channels').insert({
      name: channelName,
      created_by: profile?.id,
    }).select().single();
    if (error) { add('error', error.message); return; }
    setChannels((prev) => [...prev, data as Channel]);
    setActiveChannel(data as Channel);
    setChannelName('');
    setShowNewChannel(false);
    add('success', 'Channel created');
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
              className={cn('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors', activeChannel?.id === c.id ? 'bg-purple/15 text-white' : 'text-white/50 hover:text-white hover:bg-white/5')}
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
            <div className="px-4 py-3 border-b border-ink-border flex items-center gap-2">
              <Hash size={16} className="text-white/40" />
              <h2 className="text-sm font-semibold">{activeChannel.name}</h2>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 py-4">
              {messages.length === 0 ? (
                <EmptyState icon={<MessageSquare size={24} />} title="No messages yet" description="Start the conversation" />
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="flex gap-3 px-4">
                    <Avatar name={m.author?.full_name} src={m.author?.avatar_url} size="sm" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{m.author?.full_name || 'Unknown'}</p>
                        <span className="text-xs text-white/30">{timeAgo(m.created_at)}</span>
                      </div>
                      <p className="text-sm text-white/70 mt-0.5">{m.body}</p>
                    </div>
                  </div>
                ))
              )}
              <div ref={msgEndRef} />
            </div>
            <div className="p-4 border-t border-ink-border">
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
