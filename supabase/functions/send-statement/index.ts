// Sends a per-client account statement (كشف حساب): all installments + paid/remaining summary.
// Invoked from the app via a plain POST fetch with { contract_id } — no auth header,
// so this function must be deployed with --no-verify-jwt (see supabase/functions/README.md).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, buildEmailHtml, sendEmail, clientEmail, fmt } from '../_shared/email.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { contract_id } = await req.json();
    if (!contract_id) {
      return new Response(JSON.stringify({ sent: false, error: 'contract_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: contract, error } = await supabase
      .from('contracts').select('*, payments(*)').eq('id', contract_id).single();
    if (error || !contract) {
      return new Response(JSON.stringify({ sent: false, error: 'contract not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const email = clientEmail(contract.fields);
    if (!email) {
      return new Response(JSON.stringify({ sent: false, error: 'no email on file' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payments = (contract.payments as any[]).sort((a, b) => a.installment_number - b.installment_number);
    const paidTotal = payments.filter(p => p.paid).reduce((s, p) => s + p.amount, 0);
    const remaining = contract.unit_price - paidTotal;

    const html = buildEmailHtml({
      title: 'كشف حساب',
      clientName: contract.client_name,
      intro: `فيما يلي كشف حساب أقساطكم الخاصة بوحدتكم في مشروع "${contract.project_name}".`,
      rows: payments.map(p => ({ label: p.label, amount: p.amount, dueDate: p.due_date, paid: p.paid })),
      summaryLines: [
        `إجمالي قيمة الوحدة: ${fmt(contract.unit_price)} ريال`,
        `إجمالي المدفوع: ${fmt(paidTotal)} ريال`,
        `المتبقي: ${fmt(remaining)} ريال`,
      ],
    });

    const result = await sendEmail(email, 'كشف حساب', html);
    if (!result.ok) {
      return new Response(JSON.stringify({ sent: false, error: result.error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ sent: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
