import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the user's JWT
    const jwt = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const messages: ChatMessage[] = body.messages || [];
    const userMessage = messages[messages.length - 1]?.content || "";

    if (!userMessage.trim()) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Gather CRM context for the AI
    const [clients, invoices, projects, quotes, tasks, leads, payments, meetings, activities] =
      await Promise.all([
        supabase.from("clients").select("*").order("created_at", { ascending: false }),
        supabase.from("invoices").select("*, client:clients(company_name)").order("created_at", { ascending: false }),
        supabase.from("projects").select("*, client:clients(company_name)").order("created_at", { ascending: false }),
        supabase.from("quotes").select("*, client:clients(company_name)").order("created_at", { ascending: false }),
        supabase.from("tasks").select("*, assigned_to_profile:profiles!tasks_assigned_to_fkey(full_name)").order("created_at", { ascending: false }),
        supabase.from("leads").select("*").order("created_at", { ascending: false }),
        supabase.from("payments").select("*").order("paid_at", { ascending: false }),
        supabase.from("meetings").select("*, client:clients(company_name)").order("start_at", { ascending: true }),
        supabase.from("activities").select("*, user:profiles(full_name)").order("created_at", { ascending: false }).limit(10),
      ]);

    // Build a CRM context summary
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const today = now.toISOString().slice(0, 10);

    const monthlyRevenue = (payments.data || [])
      .filter((p: any) => {
        const d = new Date(p.paid_at);
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      })
      .reduce((s: number, p: any) => s + p.amount, 0);

    const outstanding = (invoices.data || [])
      .filter((i: any) => ["sent", "partial", "overdue"].includes(i.status))
      .reduce((s: number, i: any) => s + (i.balance || 0), 0);

    const overdueInvoices = (invoices.data || []).filter((i: any) =>
      i.status === "overdue" || (i.due_date && new Date(i.due_date) < now && !["paid", "cancelled"].includes(i.status))
    );

    const activeProjects = (projects.data || []).filter((p: any) => p.status === "in_progress");
    const delayedProjects = (projects.data || []).filter((p: any) => p.health === "delayed" && p.status !== "completed");
    const wonLeads = (leads.data || []).filter((l: any) => l.stage === "won").length;
    const totalLeads = (leads.data || []).length;
    const leadConversion = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : "0";

    const tasksDueToday = (tasks.data || []).filter((t: any) =>
      t.deadline && t.deadline.slice(0, 10) === today && t.status !== "done"
    );

    const upcomingMeetings = (meetings.data || []).filter((m: any) =>
      m.start_at && new Date(m.start_at) > now && m.status === "scheduled"
    );

    const topClients = (clients.data || [])
      .map((c: any) => ({
        name: c.company_name,
        total: (invoices.data || [])
          .filter((i: any) => i.client_id === c.id)
          .reduce((s: number, i: any) => s + i.total, 0),
      }))
      .sort((a: any, b: any) => b.total - a.total)
      .slice(0, 5);

    const crmContext = `
CRM DATA SUMMARY (as of ${now.toISOString()}):
- Clients: ${(clients.data || []).length} total (${(clients.data || []).filter((c: any) => c.status === "active").length} active, ${(clients.data || []).filter((c: any) => c.status === "prospect").length} prospects)
- Revenue this month: R${monthlyRevenue.toFixed(2)}
- Outstanding payments: R${outstanding.toFixed(2)}
- Overdue invoices: ${overdueInvoices.length}
- Active projects: ${activeProjects.length} (${delayedProjects.length} delayed)
- Leads: ${totalLeads} total, ${wonLeads} won, conversion rate ${leadConversion}%
- Tasks due today: ${tasksDueToday.length}
- Upcoming meetings: ${upcomingMeetings.length}
- Top clients by revenue: ${topClients.map((c: any) => `${c.name} (R${c.total.toFixed(0)})`).join(", ")}

OVERDUE INVOICES:
${overdueInvoices.slice(0, 5).map((i: any) => `- ${i.invoice_number}: ${i.client?.company_name || "Unknown"} - R${i.balance.toFixed(2)} (due ${i.due_date})`).join("\n") || "None"}

ACTIVE PROJECTS:
${activeProjects.slice(0, 5).map((p: any) => `- ${p.name}: ${p.client?.company_name || "N/A"} - ${p.progress}% complete - ${p.health.replace("_", " ")}`).join("\n") || "None"}

TASKS DUE TODAY:
${tasksDueToday.slice(0, 5).map((t: any) => `- ${t.title}${t.assigned_to_profile ? ` (assigned to ${t.assigned_to_profile.full_name})` : ""}`).join("\n") || "None"}

UPCOMING MEETINGS:
${upcomingMeetings.slice(0, 5).map((m: any) => `- ${m.title}: ${m.start_at} ${m.client?.company_name || ""}`).join("\n") || "None"}

RECENT ACTIVITY:
${(activities.data || []).slice(0, 5).map((a: any) => `- ${a.user?.full_name || "Someone"} ${a.description}`).join("\n") || "None"}
`;

    // Check for OpenAI API key
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    let assistantResponse: string;

    if (openaiKey) {
      // Use OpenAI for real AI responses
      const systemPrompt = `You are PURPLE AI, an internal business assistant for PURPLELOK, a South African digital agency. You have access to real-time CRM data. Answer questions about revenue, clients, projects, leads, invoices, tasks, and meetings. Be concise, professional, and helpful. Use South African Rand (R) for currency. Format responses with markdown bold (**text**) for emphasis.

Current CRM data:
${crmContext}`;

      const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.slice(-6).map((m) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            })),
          ],
          max_tokens: 800,
          temperature: 0.7,
        }),
      });

      if (openaiResponse.ok) {
        const data = await openaiResponse.json();
        assistantResponse = data.choices?.[0]?.message?.content || "I couldn't generate a response. Please try again.";
      } else {
        assistantResponse = generateLocalResponse(userMessage, crmContext);
      }
    } else {
      // Fallback: use local intelligent response based on CRM data
      assistantResponse = generateLocalResponse(userMessage, crmContext);
    }

    return new Response(
      JSON.stringify({ message: assistantResponse }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function generateLocalResponse(query: string, context: string): string {
  const q = query.toLowerCase();

  // Parse key numbers from context
  const revenueMatch = context.match(/Revenue this month: R([\d.]+)/);
  const revenue = revenueMatch ? revenueMatch[1] : "0";
  const outstandingMatch = context.match(/Outstanding payments: R([\d.]+)/);
  const outstanding = outstandingMatch ? outstandingMatch[1] : "0";
  const overdueMatch = context.match(/Overdue invoices: (\d+)/);
  const overdueCount = overdueMatch ? overdueMatch[1] : "0";
  const activeProjectsMatch = context.match(/Active projects: (\d+)/);
  const activeProjects = activeProjectsMatch ? activeProjectsMatch[1] : "0";
  const leadConversionMatch = context.match(/conversion rate ([\d.]+)%/);
  const leadConversion = leadConversionMatch ? leadConversionMatch[1] : "0";
  const tasksDueMatch = context.match(/Tasks due today: (\d+)/);
  const tasksDue = tasksDueMatch ? tasksDueMatch[1] : "0";

  if (q.includes("revenue") || q.includes("money") || q.includes("income")) {
    return `Here's your revenue overview:\n\n• **This Month:** R${revenue}\n• **Outstanding:** R${outstanding}\n• **Overdue Invoices:** ${overdueCount}\n\n${Number(outstanding) > 0 ? "I recommend following up on outstanding payments to improve cash flow." : "Cash flow looks healthy!"}`;
  }

  if (q.includes("overdue") || q.includes("late") || q.includes("unpaid")) {
    const overdueSection = context.split("OVERDUE INVOICES:")[1]?.split("\n\n")[0] || "None";
    return `You have **${overdueCount} overdue invoice(s)**.\n\n${overdueSection}\n\n**Recommendation:** Send payment reminders immediately for all overdue invoices.`;
  }

  if (q.includes("project")) {
    const projectsSection = context.split("ACTIVE PROJECTS:")[1]?.split("\n\n")[0] || "None";
    return `You have **${activeProjects} active project(s)**.\n\n${projectsSection}`;
  }

  if (q.includes("lead") || q.includes("pipeline")) {
    return `Your lead conversion rate is **${leadConversion}%**.\n\nFocus on leads in the negotiation stage — they have the highest close probability.`;
  }

  if (q.includes("task") || q.includes("due")) {
    const tasksSection = context.split("TASKS DUE TODAY:")[1]?.split("\n\n")[0] || "None";
    return `You have **${tasksDue} task(s) due today**.\n\n${tasksSection}`;
  }

  if (q.includes("meeting") || q.includes("upcoming") || q.includes("schedule")) {
    const meetingsSection = context.split("UPCOMING MEETINGS:")[1]?.split("\n\n")[0] || "None";
    return `Here are your upcoming meetings:\n\n${meetingsSection}`;
  }

  if (q.includes("client") || q.includes("top")) {
    const topClientsMatch = context.match(/Top clients by revenue: (.+)/);
    return `Your top clients by revenue:\n\n**${(topClientsMatch?.[1] || "No data yet").replace(/,/g, "\n")}**\n\nConsider upselling additional services to these valuable relationships.`;
  }

  if (q.includes("summary") || q.includes("overview") || q.includes("how") && q.includes("business")) {
    return `Here's your business summary:\n\n**Revenue**\n• This Month: R${revenue}\n• Outstanding: R${outstanding}\n\n**Operations**\n• Active Projects: ${activeProjects}\n• Tasks Due Today: ${tasksDue}\n\n**Sales**\n• Lead Conversion: ${leadConversion}%\n• Overdue Invoices: ${overdueCount}\n\n${Number(outstanding) > 0 ? "⚠️ Focus on collecting outstanding payments." : "Cash flow looks healthy!"}`;
  }

  if (q.includes("risk") || q.includes("warning") || q.includes("problem")) {
    const risks: string[] = [];
    if (Number(overdueCount) > 0) risks.push(`**${overdueCount} overdue invoice(s)**`);
    if (context.includes("delayed")) {
      const delayedMatch = context.match(/\((\d+) delayed\)/);
      if (delayedMatch) risks.push(`**${delayedMatch[1]} delayed project(s)**`);
    }
    if (Number(tasksDue) > 0) risks.push(`**${tasksDue} task(s) due today**`);
    if (risks.length === 0) return `No major risks detected. Your business is running smoothly!`;
    return `I've identified **${risks.length} area(s) of concern**:\n\n${risks.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n**Recommended actions:**\n• Send payment reminders for overdue invoices\n• Review delayed projects\n• Follow up on overdue tasks`;
  }

  return `I can help you with:\n\n• Revenue analysis and outstanding payments\n• Overdue invoices and risk assessment\n• Project status and health\n• Lead conversion and pipeline\n• Task summaries and meeting schedules\n• Top clients and upselling opportunities\n• Business summaries and recommendations\n\nTry asking: "How much revenue this month?" or "What's at risk?"`;
}
