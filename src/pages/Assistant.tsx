import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Sparkles, Send, TrendingUp, AlertCircle, FileText, DollarSign, Users, Briefcase, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  { icon: <DollarSign size={14} />, text: "How much revenue did we generate this month?" },
  { icon: <AlertCircle size={14} />, text: "Which invoices are overdue?" },
  { icon: <Briefcase size={14} />, text: "What's the status of our active projects?" },
  { icon: <TrendingUp size={14} />, text: "What's our lead conversion rate?" },
  { icon: <Users size={14} />, text: "Who are our top clients?" },
  { icon: <Clock size={14} />, text: "What tasks are due today?" },
];

export function AssistantPage() {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Hello ${profile?.full_name?.split(' ')[0] || 'there'}! I'm PURPLE AI, your business assistant. I can analyze your CRM data, summarize client histories, flag overdue invoices, predict project timelines, and answer questions about your business performance. What would you like to know?`,
    }]);
  }, [profile?.id]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  async function handleSend(text?: string) {
    const query = text || input;
    if (!query.trim()) return;
    setInput('');
    const newMessages: AIMessage[] = [...messages, { role: 'user', content: query }];
    setMessages(newMessages);
    setThinking(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: newMessages },
      });

      if (error) throw error;

      const response = (data as { message?: string })?.message || 'I could not process that request. Please try again.';
      setMessages((prev) => [...prev, { role: 'assistant', content: response }]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Sorry, I encountered an error: ${errorMsg}` }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="p-6 animate-fade-in max-w-[1000px] mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center animate-pulse-glow">
          <Sparkles size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PURPLE AI</h1>
          <p className="text-sm text-tertiary">Your AI business assistant</p>
        </div>
        <Badge variant="purple" dot className="ml-auto">Online</Badge>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
            {msg.role === 'assistant' ? (
              <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center shrink-0">
                <Sparkles size={14} className="text-white" />
              </div>
            ) : (
              <Avatar name={profile?.full_name} src={profile?.avatar_url} size="sm" />
            )}
            <div className={cn('max-w-[80%] rounded-xl px-4 py-3', msg.role === 'assistant' ? 'bg-muted border border-line' : 'bg-purple-600')}>
              <p className="text-sm text-primary whitespace-pre-line">{msg.content}</p>
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center shrink-0">
              <Sparkles size={14} className="text-white animate-pulse" />
            </div>
            <div className="bg-muted border border-line rounded-xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-tertiary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-tertiary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-tertiary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={msgEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              onClick={() => handleSend(s.text)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-muted border border-line hover:border-purple-200 hover:bg-purple-50/50 transition-all text-sm text-secondary text-left"
            >
              <span className="text-purple-600">{s.icon}</span>
              {s.text}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask PURPLE AI anything about your business..."
          className="input-field flex-1"
        />
        <Button onClick={() => handleSend()} size="icon" disabled={thinking}><Send size={16} /></Button>
      </div>
    </div>
  );
}
