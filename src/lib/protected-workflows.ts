import { supabase } from '@/lib/supabase';

async function invoke<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error('Workflow could not be completed');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Protected workflow returned no result');
  return row as T;
}

export const protectedWorkflows = {
  recordPayment(invoiceId: string, amount: number, method: string, reference: string) {
    return invoke<{ payment_id: string; invoice_id: string; invoice_status: string; amount_paid: number; balance: number }>(
      'record_payment', { p_invoice_id: invoiceId, p_amount: amount, p_method: method, p_reference: reference },
    );
  },
  sendQuote(quoteId: string) {
    return invoke<{ quote_id: string; quote_status: string }>('send_quote', { p_quote_id: quoteId });
  },
  approveQuote(quoteId: string) {
    return invoke<{ quote_id: string; quote_status: string }>('approve_quote', { p_quote_id: quoteId });
  },
  convertQuoteToInvoice(quoteId: string, invoiceNumber: string, issueDate: string, dueDate: string) {
    return invoke<{ invoice_id: string; invoice_status: string }>('convert_quote_to_invoice', {
      p_quote_id: quoteId, p_invoice_number: invoiceNumber, p_issue_date: issueDate, p_due_date: dueDate,
    });
  },
  convertQuoteToProject(quoteId: string) {
    return invoke<{ project_id: string; project_status: string }>('convert_quote_to_project', { p_quote_id: quoteId });
  },
  changeLeadStage(leadId: string, stage: string) {
    return invoke<{ lead_id: string; lead_stage: string }>('change_lead_stage', { p_lead_id: leadId, p_stage: stage });
  },
};
