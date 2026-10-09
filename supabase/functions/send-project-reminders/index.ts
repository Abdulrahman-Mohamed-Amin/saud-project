// Sends reminders to every overdue, un-reminded-out client in a project.
// Invoked from the app via a plain POST fetch with { project_name } — no auth header,
// so this function must be deployed with --no-verify-jwt (see supabase/functions/README.md).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, buildEmailHtml, sendEmail, clientEmail, fmt } from '../_shared/email.ts';

const REMINDER_LIMIT = 2;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { project_name } = await req.json();
    if (!project_name) {
      return new Response(JSON.stringify({ sent: 0, skipped: 0, error: 'project_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: contracts, error } = await supabase
      .from('contracts')
      .select('*, payments(*)')
      .eq('project_name', project_name);

    if (error || !contracts) {
      return new Response(JSON.stringify({ sent: 0, skipped: 0, error: error?.message ?? 'load failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    let sent = 0;
    let skipped = 0;

    for (const contract of contracts) {
      const overdue = (contract.payments ?? [])
        .filter((p: any) => !p.paid && new Date(p.due_date) < now)
        .sort((a: any, b: any) => a.installment_number - b.installment_number)[0];

      if (!overdue) continue;

      const email = clientEmail(contract.fields);
      if (!email || overdue.reminder_count >= REMINDER_LIMIT) {
        skipped++;
        continue;
      }

      const html = buildEmailHtml({
        title: 'تذكير بدفعة مستحقة',
        clientName: contract.client_name,
        intro: `نود تذكيركم بأن لديكم دفعة مستحقة بقيمة ${fmt(overdue.amount)} ريال بخصوص وحدتكم في مشروع "${contract.project_name}".`,
        rows: [{ label: overdue.label, amount: overdue.amount, dueDate: overdue.due_date, paid: overdue.paid }],
      });

      const result = await sendEmail(email, 'تذكير بدفعة مستحقة', html);
      if (result.ok) {
        sent++;
        await supabase.from('payments').update({
          reminder_count: overdue.reminder_count + 1,
          last_reminded_at: new Date().toISOString(),
        }).eq('id', overdue.id);
      } else {
        skipped++;
      }
    }

    return new Response(JSON.stringify({ sent, skipped }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ sent: 0, skipped: 0, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
