// Sends an early reminder email for a single installment.
// Invoked from the app via supabase.functions.invoke('send-early-reminder', { body: { payment_id, project_name } })
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, buildEmailHtml, sendEmail, clientEmail, fmt } from '../_shared/email.ts';

const REMINDER_LIMIT = 2;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { payment_id } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ sent: false, error: 'payment_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: payment, error: pErr } = await supabase
      .from('payments').select('*').eq('id', payment_id).single();
    if (pErr || !payment) {
      return new Response(JSON.stringify({ sent: false, error: 'payment not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payment.reminder_count >= REMINDER_LIMIT) {
      return new Response(JSON.stringify({ sent: false, limit_reached: true, reminder_count: payment.reminder_count }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: contract, error: cErr } = await supabase
      .from('contracts').select('*').eq('id', payment.contract_id).single();
    if (cErr || !contract) {
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

    const html = buildEmailHtml({
      title: 'تذكير بدفعة مستحقة',
      clientName: contract.client_name,
      intro: `نود تذكيركم بأن لديكم دفعة مستحقة بقيمة ${fmt(payment.amount)} ريال بخصوص وحدتكم في مشروع "${contract.project_name}".`,
      rows: [{ label: payment.label, amount: payment.amount, dueDate: payment.due_date, paid: payment.paid }],
    });

    const result = await sendEmail(email, 'تذكير بدفعة مستحقة', html);
    if (!result.ok) {
      return new Response(JSON.stringify({ sent: false, error: result.error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newCount = payment.reminder_count + 1;
    await supabase.from('payments').update({
      reminder_count: newCount,
      last_reminded_at: new Date().toISOString(),
    }).eq('id', payment_id);

    return new Response(JSON.stringify({ sent: true, reminder_count: newCount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ sent: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
